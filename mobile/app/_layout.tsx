import 'react-native-gesture-handler';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, SplashScreen } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { Fredoka_500Medium, Fredoka_600SemiBold } from '@expo-google-fonts/fredoka';
import {
  NunitoSans_400Regular,
  NunitoSans_600SemiBold,
  NunitoSans_700Bold,
} from '@expo-google-fonts/nunito-sans';
import { DMMono_400Regular } from '@expo-google-fonts/dm-mono';
import { persister, queryClient, wireAppStateToQueries } from '~/lib/query';
import { AuthProvider, useAuth } from '~/lib/auth';
import { LanguageProvider, useLang } from '~/lib/i18n';
import { useUpdateGate } from '~/lib/updates';
import { theme, ThemeProvider } from '~/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Holds the native splash until the session, the language preference AND the OTA update check are
 * all resolved.
 *
 * The update check shares this wait on purpose: applying a pending bundle here means one launch is
 * enough, instead of the open / force-close / open-again ritual that `fallbackToCacheTimeout: 0`
 * otherwise forces. It is bounded and it degrades to the old behaviour on a bad connection — see
 * lib/updates.ts. All three reads run in parallel, so on the common path it adds nothing.
 *
 * Every component in this app — this one included — is declared at MODULE scope. Defining a
 * component inline in a parent's render (or in a navigator's `options`) creates a fresh
 * function identity every render, which unmounts and remounts the whole subtree and wipes its
 * state. See the remount note in CLAUDE.md; it bit the web app once already.
 */
function Gate() {
  const { status } = useAuth();
  const { ready } = useLang();
  const updating = useUpdateGate();
  const settled = status !== 'loading' && ready && !updating;

  React.useEffect(() => {
    if (settled) SplashScreen.hideAsync().catch(() => {});
  }, [settled]);

  if (!settled) {
    // A spinner, never the login screen. Flashing "sign in" at an already-signed-in user on
    // every cold start is the fastest way to make an app feel broken.
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.bgPage,
        }}
      >
        <ActivityIndicator color={theme.color.brand} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.bgPage } }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="(app)" />
      {/* Games sit outside the tab group so they get the whole screen with no tab bar. */}
      <Stack.Screen name="play/[slug]/[mode]" options={{ animation: 'fade' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fredoka_500Medium,
    Fredoka_600SemiBold,
    NunitoSans_400Regular,
    NunitoSans_600SemiBold,
    NunitoSans_700Bold,
    DMMono_400Regular,
  });

  React.useEffect(() => wireAppStateToQueries(), []);

  // The native splash is still up at this point, so returning null shows the splash rather
  // than a white flash. Text rendered before the fonts land would reflow visibly.
  if (!fontsLoaded) return null;

  // RNGH v2 needs the tree actually wrapped — the line-1 side-effect import was enough under the
  // old architecture but no longer is. Wrapped at the root, not per call site, so the next
  // GestureDetector added anywhere does not silently stop firing.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={theme}>
          <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
            <LanguageProvider>
              <AuthProvider>
                <StatusBar style="dark" />
                <Gate />
              </AuthProvider>
            </LanguageProvider>
          </PersistQueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
