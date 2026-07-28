<#
Verify that a built APK actually carries the OTA and FCM configuration.

Why this exists: a build log is not evidence. EAS runs a CONFIGURE_EXPO_UPDATES phase that reports
success in 1ms whether or not there is an update URL to write, and the google-services Gradle
plugin is silent when it has no config to compile. Build 4 passed both and could neither update
nor receive a notification. Only the binary settles it.

Why aapt2 rather than the string-grep in docs/mobile/phase-7-dev-loop-and-delivery.md: grepping the
manifest's UTF-16 string pool proves a marker is PRESENT but cannot read its VALUE, and the values
are what matter -- EXPO_RUNTIME_VERSION in particular is stored as a resource reference
(@0x7f1300bd -> string/expo_runtime_version), so it looks like an empty attribute in the manifest
and its real value lives in resources.arsc. aapt2 decodes both. It ships with build-tools, which
any machine that can build this app already has.

  powershell -ExecutionPolicy Bypass -File mobile/scripts/verify-apk.ps1 -Apk .\mochi.apk

Get an APK to point it at with:
  cd mobile
  npx eas-cli build:list --platform android --limit 1 --json --non-interactive
  # -> .[0].artifacts.applicationArchiveUrl, then curl -sL -o mochi.apk "<url>"
#>

param(
  [Parameter(Mandatory = $true)][string]$Apk,
  # The EAS project id. Must equal extra.eas.projectId in app.config.ts.
  [string]$ProjectId = '83251f6c-1fa9-4724-ba61-39a9eb806aab',
  # Firebase sender id, i.e. project_info.project_number in google-services.json.
  [string]$SenderId = '50776955531',
  [string]$Package = 'com.mochi.lms',
  # Bump this in step with shared/version.json.
  [string]$RuntimeVersion = '2',
  [string]$Channel = 'preview'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Apk)) { throw "APK not found: $Apk" }

$buildTools = Join-Path $env:LOCALAPPDATA 'Android\Sdk\build-tools'
if (-not (Test-Path $buildTools)) { throw "No Android build-tools under $buildTools -- install the SDK." }
# Highest installed version, so this keeps working after an SDK update.
$aapt2 = Get-ChildItem $buildTools -Directory |
  Sort-Object Name -Descending |
  ForEach-Object { Join-Path $_.FullName 'aapt2.exe' } |
  Where-Object { Test-Path $_ } |
  Select-Object -First 1
if (-not $aapt2) { throw "aapt2.exe not found under $buildTools" }

$xmltree   = & $aapt2 dump xmltree   $Apk --file AndroidManifest.xml
$resources = & $aapt2 dump resources $Apk
$badging   = & $aapt2 dump badging   $Apk

# --- manifest meta-data -------------------------------------------------------------------------
# meta-data is an E: element followed by sibling A: lines, so pair name -> value by walking rather
# than assuming one line holds both.
$meta = @{}
$name = $null
foreach ($line in $xmltree) {
  if ($line -match '^\s*E: ') { $name = $null }
  if ($line -match ':name\(0x[0-9a-f]+\)="([^"]+)"')  { $name = $Matches[1]; continue }
  if ($name -and $line -match ':value\(0x[0-9a-f]+\)=(.+)$') {
    # Values arrive three ways: "quoted string" (echoed again as `(Raw: "...")`), a bare int, or
    # @0xRESID. Strip the Raw: echo FIRST, then unwrap greedily -- the channel value is JSON and
    # contains its own quotes, so a non-greedy match truncates it to `{`.
    $raw = ($Matches[1].Trim() -replace '\s+\(Raw:.*$', '')
    if ($raw -match '^"(.*)"$')            { $meta[$name] = $Matches[1] }
    elseif ($raw -match '^@(0x[0-9a-f]+)') { $meta[$name] = "@$($Matches[1])" }
    else                                   { $meta[$name] = ($raw -split ' ')[0] }
    $name = $null
  }
}

# Resolve a string resource by name, e.g. string/google_app_id -> its value.
function Get-ResString([string]$resName) {
  for ($i = 0; $i -lt $resources.Count; $i++) {
    if ($resources[$i] -match "\sstring/$([regex]::Escape($resName))\s*$") {
      # The value is the next line, formatted as: () "the value"
      if ($resources[$i + 1] -match '"(.*)"') { return $Matches[1] }
    }
  }
  return $null
}

# A meta-data value of @0xRESID has to be chased into resources.arsc. Map the id back to a name
# first, then read that name's value.
function Resolve-MetaValue([string]$value) {
  if (-not $value) { return $null }
  if ($value -notmatch '^@(0x[0-9a-f]+)$') { return $value }
  $id = $Matches[1]
  foreach ($line in $resources) {
    if ($line -match "resource\s+$([regex]::Escape($id))\s+string/(\S+)") { return Get-ResString $Matches[1] }
  }
  return "$value (unresolved)"
}

$updateUrl  = Resolve-MetaValue $meta['expo.modules.updates.EXPO_UPDATE_URL']
$runtime    = Resolve-MetaValue $meta['expo.modules.updates.EXPO_RUNTIME_VERSION']
$checkOn    = Resolve-MetaValue $meta['expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH']
$waitMs     = Resolve-MetaValue $meta['expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS']
$reqHeaders = Resolve-MetaValue $meta['expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY']

$appId    = Get-ResString 'google_app_id'
$sender   = Get-ResString 'gcm_defaultSenderId'
$fbProj   = Get-ResString 'project_id'
$fbSvc    = [bool]($xmltree | Select-String 'FirebaseMessagingService' -SimpleMatch)

# One string, not the array aapt2 hands back: `-match` against an array returns the matching
# ELEMENTS and leaves $Matches holding whatever the last element happened to match, which is how
# this first reported a Firebase broadcast-receiver class name as the package version.
$badgingText = $badging -join "`n"
$pkg  = if ($badgingText -match "package: name='([^']+)'")  { $Matches[1] } else { '?' }
$vc   = if ($badgingText -match "versionCode='([^']+)'")    { $Matches[1] } else { '?' }
$vn   = if ($badgingText -match "versionName='([^']+)'")    { $Matches[1] } else { '?' }

# --- assertions ---------------------------------------------------------------------------------
$expectedUrl = "https://u.expo.dev/$ProjectId"
$checks = @(
  @{ n = 'OTA  update url present and correct'; ok = ($updateUrl -eq $expectedUrl);        d = $updateUrl }
  @{ n = 'OTA  runtimeVersion matches config';  ok = ($runtime -eq $RuntimeVersion);       d = "EXPO_RUNTIME_VERSION=$runtime (expected $RuntimeVersion)" }
  @{ n = 'OTA  check-on-launch configured';     ok = ([string]::IsNullOrWhiteSpace($checkOn) -eq $false); d = $checkOn }
  @{ n = 'OTA  launch wait is 0ms';             ok = ($waitMs -eq '0');                    d = "fallbackToCacheTimeout -> ${waitMs}ms" }
  @{ n = 'OTA  channel stamped by EAS';         ok = ($reqHeaders -like "*`"expo-channel-name`":`"$Channel`"*"); d = $reqHeaders }
  @{ n = 'FCM  google_app_id compiled in';      ok = ($appId -like "1:${SenderId}:android:*"); d = $appId }
  @{ n = 'FCM  gcm_defaultSenderId compiled in';ok = ($sender -eq $SenderId);              d = $sender }
  @{ n = 'FCM  firebase project';               ok = ([string]::IsNullOrWhiteSpace($fbProj) -eq $false); d = $fbProj }
  @{ n = 'FCM  messaging service in manifest';  ok = $fbSvc;                               d = 'bundled by expo-notifications' }
  @{ n = 'APK  package name';                   ok = ($pkg -eq $Package);                  d = $pkg }
)

$checks | ForEach-Object {
  [pscustomobject]@{
    Check  = $_.n
    Result = if ($_.ok) { 'PASS' } else { 'FAIL' }
    Value  = $_.d
  }
} | Format-Table -AutoSize

$failed = ($checks | Where-Object { -not $_.ok }).Count
"versionCode=$vc  versionName=$vn"
# versionName is v0.0000 on every EAS build by design -- EAS re-inits the upload as a 1-commit
# repo so the derived build number is reported as 0. gitSha, from EAS_BUILD_GIT_COMMIT_HASH, is
# the identifier that survives. See scripts/git-version.mjs.
if ($failed) { "$failed check(s) FAILED"; exit 1 } else { 'all checks passed'; exit 0 }
