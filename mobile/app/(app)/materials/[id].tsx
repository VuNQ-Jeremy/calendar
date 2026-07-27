import React from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Camera, FileUp, Paperclip } from 'lucide-react-native';
import { ChipSelect } from '~/components/ChipSelect';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useLang } from '~/lib/i18n';
import { iso, todayDate } from '~/lib/cal';
import { MAT_TYPES, MAT_TYPE_IDS, isLinkType } from '~/lib/mat-types';
import { useClasses, useMaterialMutations, useMaterials } from '~/lib/staff-data';
import { useTheme } from '~/theme';
import { Body, Button, Card, Input, Muted, ProgressBar, Screen } from '~/ui';

/**
 * Add or edit a material. `id === 'new'` is the create form.
 *
 * Three ways to attach content, which is two more than the web has:
 *
 *   - **A file** — `expo-document-picker`, then a multipart POST.
 *   - **A link** — `type: link | video`, no file, plain JSON.
 *   - **A photo** — `expo-image-picker` straight from the camera. New capability, and the one
 *     teachers will actually use: photograph the whiteboard, attach it to the class, done. The
 *     web cannot do this at all.
 *
 * The 20 MB cap is checked HERE, before a byte is uploaded. The server returns 413 over it
 * (`app/routes/api.materials.tsx:37`), but discovering that after ninety seconds of uploading on
 * mobile data is a bad way to learn the limit.
 */

const MAX_UPLOAD = 20 * 1024 * 1024;

/** The `{ uri, name, type }` shape React Native's FormData turns into a multipart file part. */
interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export default function MaterialEditor() {
  const th = useTheme();
  const { t } = useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const { data: materials } = useMaterials();
  const { data: classes } = useClasses();
  const { save } = useMaterialMutations();
  const existing = materials?.find((m) => m.id === id);

  const [title, setTitle] = React.useState('');
  const [type, setType] = React.useState('notes');
  const [classId, setClassId] = React.useState('');
  const [scope, setScope] = React.useState<'class' | 'event'>('class');
  const [url, setUrl] = React.useState('');
  const [favorite, setFavorite] = React.useState(false);
  const [fileName, setFileName] = React.useState('');
  const [picked, setPicked] = React.useState<PickedFile | null>(null);
  const [tooLarge, setTooLarge] = React.useState(false);
  const [pct, setPct] = React.useState<number | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    if (isNew || hydrated || !existing) return;
    setTitle(existing.title);
    setType(existing.type);
    setClassId(existing.classId ?? '');
    setScope(existing.scope);
    setUrl(existing.url ?? '');
    setFavorite(existing.favorite);
    setFileName(existing.fileName ?? '');
    setHydrated(true);
  }, [existing, isNew, hydrated]);

  const link = isLinkType(type);

  const accept = (f: PickedFile) => {
    if (f.size > MAX_UPLOAD) {
      setTooLarge(true);
      return;
    }
    setTooLarge(false);
    setPicked(f);
    setFileName(f.name);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const pickDocument = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    const a = res.assets?.[0];
    if (res.canceled || !a) return;
    accept({
      uri: a.uri,
      name: a.name,
      mimeType: a.mimeType ?? 'application/octet-stream',
      size: a.size ?? 0,
    });
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    const a = res.assets?.[0];
    if (res.canceled || !a) return;
    accept({
      uri: a.uri,
      name: a.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: a.mimeType ?? 'image/jpeg',
      // `fileSize` is undefined on some Android providers; 0 means "unknown", and an unknown
      // size is allowed through to the server's own 413 rather than blocked here on a guess.
      size: a.fileSize ?? 0,
    });
  };

  const onSave = () => {
    const input = {
      title: title.trim() || t('mat_untitled'),
      type: type as 'notes' | 'worksheet' | 'video' | 'link' | 'curriculum',
      classId: classId || null,
      url: link ? url.trim() || null : null,
      fileName: link ? null : fileName || null,
      favorite,
      addedAt: existing?.addedAt ?? iso(todayDate()),
      scope,
    };

    let form: FormData | undefined;
    if (picked && !link) {
      form = new FormData();
      for (const [k, v] of Object.entries(input)) {
        if (v === null || v === undefined) continue;
        form.append(k, String(v));
      }
      // React Native's FormData accepts this object literal as a file part and builds the
      // multipart body from it; the DOM's File type does not exist here.
      form.append('file', {
        uri: picked.uri,
        name: picked.name,
        type: picked.mimeType,
      } as unknown as Blob);
    }

    setPct(form ? 0 : null);
    save.mutate(
      { id: isNew ? undefined : id, input, form, onProgress: setPct },
      {
        onSuccess: () => router.back(),
        onSettled: () => setPct(null),
      },
    );
  };

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={isNew ? t('mat_add') : t('mat_edit')} subtitle={existing?.title} />

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={{ gap: th.spacing[4] }}>
          <Input
            label={t('mat_title_lbl')}
            value={title}
            onChangeText={setTitle}
            autoFocus={isNew}
          />
          <ChipSelect
            label={t('mat_type')}
            value={type}
            onChange={setType}
            options={MAT_TYPE_IDS.map((k) => ({ value: k, label: t(MAT_TYPES[k].tk) }))}
          />
          <ChipSelect
            label={t('class')}
            value={classId}
            onChange={setClassId}
            options={[
              { value: '', label: t('mat_unfiled') },
              ...(classes ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <ChipSelect
            label={t('mat_scope')}
            value={scope}
            onChange={(v) => setScope(v as 'class' | 'event')}
            options={[
              { value: 'class', label: t('mat_scope_class') },
              { value: 'event', label: t('mat_scope_event') },
            ]}
          />
        </Card>

        <Card style={{ gap: th.spacing[3] }}>
          {link ? (
            <Input
              label={t('mat_url')}
              value={url}
              onChangeText={setUrl}
              placeholder="https://…"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : (
            <>
              <Body style={{ fontFamily: th.font.bodyBold, fontSize: th.text.sm.fontSize }}>
                {t('mat_file')}
              </Body>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: th.spacing[3],
                  padding: th.spacing[4],
                  borderWidth: 1.5,
                  borderStyle: 'dashed',
                  borderColor: th.color.borderStrong,
                  borderRadius: th.radius.md,
                }}
              >
                <Paperclip size={18} color={th.color.textMuted} />
                {fileName ? (
                  <Body style={{ flex: 1 }} numberOfLines={1}>
                    {fileName}
                  </Body>
                ) : (
                  <Muted style={{ flex: 1 }}>{t('mat_choose_file')}</Muted>
                )}
              </View>

              <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
                <Button
                  variant="secondary"
                  style={{ flex: 1 }}
                  onPress={() => void pickDocument()}
                  iconLeft={<FileUp size={16} color={th.color.textStrong} />}
                >
                  {t('mat_pick_file')}
                </Button>
                <Button
                  variant="secondary"
                  style={{ flex: 1 }}
                  onPress={() => void takePhoto()}
                  iconLeft={<Camera size={16} color={th.color.textStrong} />}
                >
                  {t('mat_take_photo')}
                </Button>
              </View>

              <Muted>{t('mat_size_hint')}</Muted>
              {tooLarge ? (
                <Body style={{ color: th.status.danger }}>{t('mat_too_large')}</Body>
              ) : null}
            </>
          )}
        </Card>

        {pct !== null ? (
          <Card flat style={{ gap: th.spacing[2] }}>
            <Body>{pct < 0 ? t('mat_uploading') : t('mat_uploading_pct', { n: pct })}</Body>
            {/* A negative pct means the platform could not report a total; show a full bar
                rather than a stuck 0%, and let the label carry the honesty. */}
            <ProgressBar value={pct < 0 ? 100 : pct} />
          </Card>
        ) : null}

        {save.isError ? <Body style={{ color: th.status.danger }}>{t('mat_save_failed')}</Body> : null}

        <Button block loading={save.isPending} onPress={onSave}>
          {save.isPending ? t('mat_saving') : t('save')}
        </Button>
        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}
