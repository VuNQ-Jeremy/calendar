import React from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ExternalLink, Share2 } from 'lucide-react-native';
import { ScreenHeader } from '~/components/ScreenHeader';
import { getToken } from '~/lib/auth';
import { BASE } from '~/lib/api';
import { useLang } from '~/lib/i18n';
import { useMaterials } from '~/lib/staff-data';
import { useTheme } from '~/theme';
import { Body, Button, Card, Heading, Muted, Screen } from '~/ui';

/**
 * Task 4.3's material viewer.
 *
 * `src/calendar/material-preview.tsx` renders .docx with `docx-preview`, which walks the DOM and
 * therefore does not port at all. Rather than ship a document renderer, this hands the file to
 * whatever the platform already has:
 *
 *   - **Images, text, SVG** render inline in a `WebView`. That is why `react-native-webview` is a
 *     dependency: `/materials/:id/view` requires `Authorization: Bearer` (it is
 *     `requireStaffCookieOrBearer`, and the phone has no cookie), and a WebView can send request
 *     headers where `expo-web-browser` cannot.
 *   - **Everything else — .docx, .doc, .pdf, spreadsheets — downloads with the bearer header and
 *     goes to the platform viewer** via `expo-sharing`. Android's document viewers are good; using
 *     them is the right answer, not a fallback. (Android's WebView cannot display a PDF at all,
 *     so PDFs belong on this path too.)
 *   - **A link-type material** just opens in the browser; there is no file to fetch.
 */

/** Extensions Android's WebView renders natively. Everything else is handed off. */
const INLINE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'txt', 'htm', 'html']);

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function extOf(fileName: string | null | undefined): string {
  return fileName?.split('.').pop()?.toLowerCase() ?? '';
}

export default function MaterialViewer() {
  const th = useTheme();
  const { t } = useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: materials, isLoading } = useMaterials();

  const [token, setToken] = React.useState<string | null>(null);
  const [handing, setHanding] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void getToken().then((tk) => {
      if (!cancelled) setToken(tk);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const material = materials?.find((m) => m.id === id);
  const ext = extOf(material?.fileName);
  const hasFile = !!material?.fileName;
  const inline = hasFile && INLINE_EXTS.has(ext);
  const viewUrl = `${BASE}/materials/${id}/view`;

  /** Download with the bearer header, then let Android pick a viewer. */
  const handOff = async () => {
    if (!material?.fileName || !token) return;
    setHanding(true);
    setFailed(false);
    try {
      const dir = new Directory(Paths.cache, 'materials');
      if (!dir.exists) dir.create({ intermediates: true });
      // Named after the material id so re-opening the same file twice does not collide with a
      // different material that happens to share a filename.
      const target = new File(dir, `${id}-${material.fileName}`);
      if (target.exists) target.delete();
      const downloaded = await File.downloadFileAsync(viewUrl, target, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!(await Sharing.isAvailableAsync())) {
        setFailed(true);
        return;
      }
      await Sharing.shareAsync(downloaded.uri, {
        mimeType: MIME[ext],
        dialogTitle: material.title,
      });
    } catch {
      setFailed(true);
    } finally {
      setHanding(false);
    }
  };

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader
        title={material?.title ?? t('mat_title')}
        subtitle={material?.fileName ?? material?.url ?? undefined}
      />

      {isLoading && !materials ? (
        <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />
      ) : !material ? (
        <View style={{ padding: th.spacing[5] }}>
          <Card>
            <Heading>{t('mat_none_title')}</Heading>
            <Muted>{t('err_not_found_msg')}</Muted>
          </Card>
        </View>
      ) : inline && token ? (
        <WebView
          source={{ uri: viewUrl, headers: { Authorization: `Bearer ${token}` } }}
          style={{ flex: 1, backgroundColor: th.color.bgPage }}
          startInLoadingState
          renderLoading={() => <ActivityIndicator color={th.color.brand} />}
          // The view route serves one file; there is nothing to navigate to from here.
          javaScriptEnabled={false}
          allowsBackForwardNavigationGestures={false}
        />
      ) : (
        <View style={{ padding: th.spacing[5], gap: th.spacing[4] }}>
          <Card style={{ gap: th.spacing[3] }}>
            <Heading>{material.title}</Heading>
            <Muted>{hasFile ? t('mat_open_in_viewer') : t('mat_open_link_sub')}</Muted>

            {hasFile ? (
              <Button
                variant="primary"
                block
                loading={handing || (!token && !failed)}
                onPress={() => void handOff()}
                iconLeft={<Share2 size={16} color={th.color.textOnBrand} />}
              >
                {t('mat_open_in_viewer_btn')}
              </Button>
            ) : material.url ? (
              <Button
                variant="primary"
                block
                onPress={() => void Linking.openURL(material.url!)}
                iconLeft={<ExternalLink size={16} color={th.color.textOnBrand} />}
              >
                {t('mat_open_link')}
              </Button>
            ) : (
              <Muted>{t('mat_preview_unsupported')}</Muted>
            )}

            {failed ? <Body style={{ color: th.status.danger }}>{t('mat_open_failed')}</Body> : null}
          </Card>
        </View>
      )}
    </Screen>
  );
}
