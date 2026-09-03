import React from 'react';
import { Image, Linking, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { onlineManager } from '@tanstack/react-query';
import { ChevronLeft, Link2 } from 'lucide-react-native';
import { useLang } from '~/lib/i18n';
import { usePracticeMy, useSubmitPractice } from '~/lib/use-practice';
import {
  clearTimer,
  elapsedMs,
  EMPTY_TIMER,
  fmtDuration,
  isHm,
  readTimer,
  startTimer,
  stopTimer,
  timeRange,
  type TimerState,
} from '~/lib/practice-timer';
import { MEDIA_MAX_BYTES, VIDEO_MAX_SECONDS } from '@mochi/shared/logic/practice';
import { useTheme } from '~/theme';
import { Body, Button, Card, Heading, Input, Muted, ProgressBar, Screen, Tag, Title } from '~/ui';
import type { PracticeStudentTask } from '~/lib/types';

/** The `{ uri, name, type }` shape React Native's FormData turns into a multipart file part. */
interface Picked {
  uri: string;
  name: string;
  type: string;
}

type Phase = 'idle' | 'compressing' | 'uploading';

/**
 * One practice task: the timer, the proof, and Submit.
 *
 * Online-only by design (decision #13). This screen deliberately does NOT use the offline outbox
 * that `lib/db.ts` gives the rest of the app: a submission is a 50 MB video plus a deadline, and a
 * queued one that uploads at 00:03 would be a miss the student believed they had avoided. Better
 * to say "connect to submit" than to promise something the clock will take back.
 */
export default function PracticeTaskScreen() {
  const th = useTheme();
  const { t } = useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = usePracticeMy();
  const submit = useSubmitPractice();

  const task = data?.tasks.find((x) => x.id === id);
  const today = data?.todayIct ?? '';

  const [timer, setTimer] = React.useState<TimerState>(EMPTY_TIMER);
  const [now, setNow] = React.useState(() => new Date());
  const [editing, setEditing] = React.useState(false);
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [note, setNote] = React.useState('');
  const [picked, setPicked] = React.useState<Picked | null>(null);
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [pct, setPct] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!id) return;
    void readTimer(id).then(setTimer);
  }, [id]);

  // Only ticks while the timer is running; a stopped timer needs no clock.
  const running = !!timer.startedAt && !timer.stoppedAt;
  React.useEffect(() => {
    if (!running) return;
    const h = setInterval(() => setNow(new Date()), 500);
    return () => clearInterval(h);
  }, [running]);

  React.useEffect(() => {
    if (!task) return;
    setNote(task.note ?? '');
  }, [task?.id]);

  if (!task) {
    return (
      <Screen edges={{ top: true }}>
        <View style={{ padding: th.spacing[5] }}>
          <Muted>{t('m_pr_empty')}</Muted>
        </View>
      </Screen>
    );
  }

  const range = timeRange(timer, now);
  const effFrom = editing ? from : (range?.from ?? task.timeFrom ?? '');
  const effTo = editing ? to : (range?.to ?? task.timeTo ?? '');
  const overdue = task.date < today;
  const done = task.status === 'accepted' || task.status === 'teacher_done';
  const needsProof = task.proofType !== 'none';
  const hasProof = !!picked || !!task.mediaPath;
  const online = onlineManager.isOnline();

  const canSubmit = !overdue && !done && phase === 'idle' && online && (!needsProof || hasProof);

  const startStop = async () => {
    if (!running) setTimer(await startTimer(task.id, new Date()));
    else setTimer(await stopTimer(task.id, new Date()));
  };

  const pickImage = async (fromCamera: boolean) => {
    setError(null);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    const a = res.assets?.[0];
    if (res.canceled || !a) return;
    if ((a.fileSize ?? 0) > MEDIA_MAX_BYTES) {
      setError(t('m_pr_file_too_big'));
      return;
    }
    setPicked({
      uri: a.uri,
      name: a.fileName ?? `proof-${Date.now()}.jpg`,
      type: a.mimeType ?? 'image/jpeg',
    });
  };

  const pickVideo = async (fromCamera: boolean) => {
    setError(null);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const opts = { mediaTypes: ['videos' as const], videoMaxDuration: VIDEO_MAX_SECONDS };
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    const a = res.assets?.[0];
    if (res.canceled || !a) return;
    if ((a.duration ?? 0) > VIDEO_MAX_SECONDS * 1000) {
      setError(t('m_pr_video_too_long'));
      return;
    }

    // Compression happens on the device, before the upload: a minute of 1080p off a modern phone
    // is well past the 50 MB ceiling, and a student on 4G should not be paying for the raw file.
    let uri = a.uri;
    try {
      setPhase('compressing');
      setPct(0);
      const { Video } = await import('react-native-compressor');
      uri = await Video.compress(a.uri, { compressionMethod: 'auto', maxSize: 1280 }, (p: number) =>
        setPct(Math.round(p * 100)),
      );
    } catch {
      // A device the native module cannot serve still gets to submit — the server's own 413 is
      // the backstop, and refusing here would block the task entirely.
      uri = a.uri;
    } finally {
      setPhase('idle');
      setPct(0);
    }
    setPicked({ uri, name: `proof-${Date.now()}.mp4`, type: 'video/mp4' });
  };

  const onSubmit = () => {
    if (editing && ((from && !isHm(from)) || (to && !isHm(to)))) return;
    const form = new FormData();
    form.append('studentTaskId', task.id);
    if (effFrom) form.append('timeFrom', effFrom);
    if (effTo) form.append('timeTo', effTo);
    if (note.trim()) form.append('note', note.trim());
    if (picked) {
      // React Native's FormData accepts this object literal as a file part; the DOM File type
      // does not exist here.
      form.append('file', picked as unknown as Blob);
    }
    setPhase('uploading');
    setPct(0);
    setError(null);
    submit.mutate(
      { form, onProgress: setPct },
      {
        onSuccess: () => {
          void clearTimer(task.id);
          router.back();
        },
        onError: (err) => setError(String((err as Error)?.message ?? err)),
        onSettled: () => {
          setPhase('idle');
          setPct(0);
        },
      },
    );
  };

  return (
    <Screen edges={{ top: true }}>
      <ScrollView contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}>
        <Pressable
          onPress={() => router.back()}
          style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}
        >
          <ChevronLeft size={18} color={th.color.textMuted} />
          <Muted>{task.className}</Muted>
        </Pressable>

        <Title>{task.title}</Title>
        <ProofLine task={task} />

        {task.url || task.materialTitle ? (
          <Pressable
            onPress={() => (task.url ? void Linking.openURL(task.url) : undefined)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}
          >
            <Link2 size={16} color={th.color.brand} />
            <Body>{task.materialTitle ?? task.url}</Body>
          </Pressable>
        ) : null}

        {overdue ? (
          <Card>
            <Muted>{t('m_pr_excuse_late')}</Muted>
          </Card>
        ) : null}

        {done || task.status === 'submitted' ? (
          <Card style={{ gap: th.spacing[2] }}>
            <Tag color="green">
              {t(task.status === 'submitted' ? 'm_pr_submitted' : 'pr_status_accepted')}
            </Tag>
            {task.timeFrom || task.timeTo ? (
              <Muted>{`${task.timeFrom ?? '—'}–${task.timeTo ?? '—'}`}</Muted>
            ) : null}
            {task.feedback ? (
              <View style={{ gap: 2 }}>
                <Muted>{t('m_pr_feedback')}</Muted>
                <Body>{task.feedback}</Body>
              </View>
            ) : null}
          </Card>
        ) : null}

        {task.status === 'rejected' && task.rejectReason ? (
          <Card>
            <Body>{t('m_pr_rejected', { reason: task.rejectReason })}</Body>
          </Card>
        ) : null}

        {!overdue && !done ? (
          <>
            <Card style={{ gap: th.spacing[3] }}>
              <Heading>{t('m_pr_time_range')}</Heading>
              <Body style={{ fontFamily: th.font.mono }}>{fmtDuration(elapsedMs(timer, now))}</Body>
              <Button variant={running ? 'secondary' : 'primary'} onPress={() => void startStop()}>
                {t(running ? 'm_pr_stop_timer' : 'm_pr_start_timer')}
              </Button>
              {range || task.timeFrom ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
                  <Muted>{`${effFrom || '—'}–${effTo || '—'}`}</Muted>
                  <Button
                    variant="ghost"
                    onPress={() => {
                      setFrom(effFrom);
                      setTo(effTo);
                      setEditing(true);
                    }}
                  >
                    {t('m_pr_edit_time')}
                  </Button>
                </View>
              ) : null}
              {editing ? (
                <View style={{ flexDirection: 'row', gap: th.spacing[3] }}>
                  <Input
                    containerStyle={{ flex: 1 }}
                    value={from}
                    onChangeText={setFrom}
                    placeholder="20:00"
                    error={from && !isHm(from) ? ' ' : undefined}
                  />
                  <Input
                    containerStyle={{ flex: 1 }}
                    value={to}
                    onChangeText={setTo}
                    placeholder="20:40"
                    error={to && !isHm(to) ? ' ' : undefined}
                  />
                </View>
              ) : null}
            </Card>

            <Input
              label={t('pr_note')}
              value={note}
              onChangeText={setNote}
              placeholder={t('m_pr_note_ph')}
              multiline
            />

            {needsProof ? (
              <Card style={{ gap: th.spacing[3] }}>
                <Heading>{t('pr_proof')}</Heading>
                {picked ? (
                  picked.type.startsWith('image/') ? (
                    <Image
                      source={{ uri: picked.uri }}
                      style={{ width: '100%', height: 200, borderRadius: th.radius.md }}
                      resizeMode="cover"
                    />
                  ) : (
                    <Muted>{picked.name}</Muted>
                  )
                ) : null}
                {task.proofType !== 'video' ? (
                  <View style={{ flexDirection: 'row', gap: th.spacing[3] }}>
                    <Button
                      style={{ flex: 1 }}
                      variant="secondary"
                      onPress={() => void pickImage(true)}
                    >
                      {t('m_pr_take_photo')}
                    </Button>
                    <Button
                      style={{ flex: 1 }}
                      variant="secondary"
                      onPress={() => void pickImage(false)}
                    >
                      {t('m_pr_add_photo')}
                    </Button>
                  </View>
                ) : null}
                {task.proofType !== 'photo' ? (
                  <View style={{ flexDirection: 'row', gap: th.spacing[3] }}>
                    <Button
                      style={{ flex: 1 }}
                      variant="secondary"
                      onPress={() => void pickVideo(true)}
                    >
                      {t('m_pr_record_video')}
                    </Button>
                    <Button
                      style={{ flex: 1 }}
                      variant="secondary"
                      onPress={() => void pickVideo(false)}
                    >
                      {t('m_pr_add_video')}
                    </Button>
                  </View>
                ) : null}
              </Card>
            ) : null}

            {phase !== 'idle' ? (
              <View style={{ gap: th.spacing[2] }}>
                <Muted>
                  {phase === 'compressing' ? t('m_pr_compressing') : t('m_pr_uploading', { pct })}
                </Muted>
                <ProgressBar value={pct} />
              </View>
            ) : null}

            {!online ? <Muted>{t('m_pr_offline')}</Muted> : null}
            {needsProof && !hasProof ? (
              <Muted>
                {t('m_pr_need_proof', {
                  kind: t(task.proofType === 'video' ? 'pr_proof_video' : 'pr_proof_photo'),
                })}
              </Muted>
            ) : null}
            {error ? <Muted style={{ color: th.status.danger }}>{error}</Muted> : null}

            <Button block disabled={!canSubmit} loading={phase === 'uploading'} onPress={onSubmit}>
              {t(task.status === 'rejected' ? 'm_pr_resubmit' : 'm_pr_submit')}
            </Button>
          </>
        ) : null}

        <View style={{ height: th.spacing[10] }} />
      </ScrollView>
    </Screen>
  );
}

function ProofLine({ task }: { task: PracticeStudentTask }) {
  const { t } = useLang();
  const key =
    task.proofType === 'photo'
      ? 'pr_proof_photo'
      : task.proofType === 'video'
        ? 'pr_proof_video'
        : task.proofType === 'none'
          ? 'pr_proof_none'
          : 'pr_proof_either';
  return <Muted>{`${t('pr_proof')}: ${t(key)}`}</Muted>;
}
