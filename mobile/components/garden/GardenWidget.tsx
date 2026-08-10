import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight, Clock, Flame, Pencil, Sprout } from 'lucide-react-native';
import { daysBetweenVn } from '@mochi/shared/logic/garden';
import { formatDmy } from '@mochi/shared/logic/dates';
import { parseModes } from '@mochi/shared/logic/flashcards';
import { useLang } from '~/lib/i18n';
import { useHarvest, usePlant, useUpdatePlant } from '~/lib/use-garden';
import { useTheme } from '~/theme';
import {
  Badge,
  Body,
  Button,
  Card,
  ColorPicker,
  Heading,
  IconButton,
  Input,
  Muted,
  ProgressBar,
} from '~/ui';
import { Confetti, PlantSvg, clampStage, stageKey } from './PlantArt';
import type { ColorIdValue, StudentAssignmentChip } from '~/lib/types';

/**
 * The student's own plant, at the top of the vocabulary screen — the port of `GardenWidget` in
 * `src/garden/garden-widget.tsx`.
 *
 * Every value drawn here was settled by the server. This component never decides whether a plant
 * wilted or how much growth is left; it reads `/api/garden/plant` and draws it. Dates are compared
 * against the response's `today`, never the device clock — a phone set to Sydney must not see a
 * deadline a day early.
 *
 * The two writes it owns are the harvest tap and the rename/repaint dialog.
 */

/** How near a deadline (or a stage drop) has to be before it is drawn as urgent. */
const URGENT_DAYS = 2;

const PLANT_SIZE = 128;

export function GardenWidget() {
  const th = useTheme();
  const { t } = useLang();
  const { data, isLoading } = usePlant();
  const harvest = useHarvest();
  const updatePlant = useUpdatePlant();

  const [editing, setEditing] = React.useState<{
    plantName: string;
    potColor: ColorIdValue;
  } | null>(null);
  const [flash, setFlash] = React.useState<'done' | 'failed' | null>(null);
  const [celebrating, setCelebrating] = React.useState(false);
  const [popping, setPopping] = React.useState(false);

  // A stage-up is only visible by comparing payloads, so the pop is triggered from the change
  // rather than from the mutation's reply — that also covers a round played on the web or on
  // another device, which arrives on the next read.
  const stage = data?.stage ?? 0;
  const prevStage = React.useRef(stage);
  React.useEffect(() => {
    const grew = stage > prevStage.current;
    prevStage.current = stage;
    if (!grew) return;
    setPopping(true);
    const id = setTimeout(() => setPopping(false), 900);
    return () => clearTimeout(id);
  }, [stage]);

  const onHarvest = () => {
    harvest.mutate(undefined, {
      onSuccess: () => {
        setFlash('done');
        setCelebrating(true);
      },
      // A 409 is what a double tap looks like — a normal outcome, reported, not thrown at the user.
      onError: () => setFlash('failed'),
    });
  };

  React.useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => {
      setFlash(null);
      setCelebrating(false);
    }, 2400);
    return () => clearTimeout(id);
  }, [flash]);

  // Nothing to show while the first read is in flight, and nothing to show if it failed: the
  // vocabulary screen has to work either way, so the widget is simply absent. Same reasoning as the
  // web, where the garden payload degrades to null in the minutes after a deploy.
  if (!data) {
    void isLoading;
    return null;
  }

  const titleKey = data.titleId ? `garden_title_${data.titleId}` : null;
  const dropsSoon =
    !data.dead &&
    data.nextDropDate !== null &&
    daysBetweenVn(data.today, data.nextDropDate) <= URGENT_DAYS;
  // Priority: dead beats wilting beats an empty pot. The drop warning is deliberately NOT in that
  // chain — a stage only ever drops off a plant that is already wilted, so as a rival it could never
  // win, and as an extra line it says the thing that matters (which day).
  const state = data.dead
    ? t('garden_dead')
    : data.wilted
      ? t('garden_wilting')
      : data.stage === 0
        ? t('garden_empty')
        : null;

  const classId = data.classes[0]?.id ?? null;

  return (
    <Card style={{ gap: th.spacing[4] }}>
      <View style={{ flexDirection: 'row', gap: th.spacing[4], alignItems: 'flex-start' }}>
        <View style={{ width: PLANT_SIZE, height: PLANT_SIZE }}>
          <PlantSvg
            stage={clampStage(data.stage)}
            wilted={data.wilted}
            dead={data.dead}
            potColor={data.potColor}
            size={PLANT_SIZE}
            animateStageUp={popping}
            sway={true}
            harvesting={celebrating}
          />
          {celebrating ? <Confetti height={PLANT_SIZE} color={th.color.brand} /> : null}
        </View>

        <View style={{ flex: 1, gap: th.spacing[2] }}>
          <View style={{ flexDirection: 'row', gap: th.spacing[2], alignItems: 'center' }}>
            <Sprout size={18} color={th.category.green.ink} />
            {data.plantName ? (
              <Heading style={{ flex: 1 }} numberOfLines={1}>
                {data.plantName}
              </Heading>
            ) : (
              <Muted style={{ flex: 1, fontStyle: 'italic' }}>{t('garden_unnamed')}</Muted>
            )}
            {data.hasPlant ? (
              <IconButton
                size="sm"
                label={t('garden_rename')}
                onPress={() =>
                  setEditing({
                    plantName: data.plantName ?? '',
                    potColor: data.potColor as ColorIdValue,
                  })
                }
              >
                <Pencil size={16} color={th.color.textMuted} />
              </IconButton>
            ) : null}
          </View>

          <View
            style={{
              flexDirection: 'row',
              gap: th.spacing[2],
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <Body style={{ fontFamily: th.font.bodyBold }}>
              {t(stageKey(data.stage, data.dead))}
            </Body>
            <Muted>
              {data.growthLeftToday > 0
                ? t('garden_growth_left', { n: data.growthLeftToday })
                : t('garden_growth_none')}
            </Muted>
          </View>

          <View
            style={{
              flexDirection: 'row',
              gap: th.spacing[2],
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {data.streak > 0 ? (
              <View style={{ flexDirection: 'row', gap: th.spacing[1], alignItems: 'center' }}>
                <Flame size={16} color={th.category.orange.ink} />
                <Body>{t('garden_streak', { n: data.streak })}</Body>
              </View>
            ) : null}
            <Badge color="orange">{t('garden_fruit_month', { n: data.fruitMonth })}</Badge>
            <Badge color="green">{t('garden_fruit_total', { n: data.fruitsTotal })}</Badge>
            {titleKey ? <Badge color="violet">{t(titleKey)}</Badge> : null}
          </View>

          {state ? <Body>{state}</Body> : null}
          {dropsSoon ? (
            <Muted style={{ color: th.category.rose.ink }}>
              {t('garden_drop_warning', { date: formatDmy(data.nextDropDate as string) })}
            </Muted>
          ) : null}
        </View>
      </View>

      {data.harvestReady ? (
        <Button loading={harvest.isPending} onPress={onHarvest}>
          {t('garden_harvest')}
        </Button>
      ) : null}
      {flash ? (
        <Body
          style={{
            fontFamily: th.font.bodyBold,
            color: flash === 'done' ? th.color.textStrong : th.category.rose.ink,
          }}
        >
          {t(flash === 'done' ? 'garden_harvest_done' : 'garden_harvest_failed')}
        </Body>
      ) : null}

      {data.assignments.length > 0 ? (
        <View style={{ gap: th.spacing[2] }}>
          {data.assignments.map((a) => (
            <AssignmentChip key={a.id} chip={a} today={data.today} />
          ))}
        </View>
      ) : null}

      {classId ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push(`/vocabulary/garden/${encodeURIComponent(classId)}`)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[1], minHeight: 44 }}
        >
          <Body style={{ color: th.color.brand, fontFamily: th.font.bodyBold }}>
            {t('garden_class_title')}
          </Body>
          <ChevronRight size={16} color={th.color.brand} />
        </Pressable>
      ) : null}

      {editing ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setEditing(null)}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
            onPress={() => setEditing(null)}
            style={{
              flex: 1,
              backgroundColor: 'rgba(60,40,25,0.45)',
              justifyContent: 'center',
              padding: th.spacing[6],
            }}
          >
            {/* An inner Pressable with no handler swallows taps so they do not reach the scrim. */}
            <Pressable
              style={{
                backgroundColor: th.color.surfaceCard,
                borderRadius: th.radius.xl,
                padding: th.spacing[5],
                gap: th.spacing[4],
              }}
            >
              <Heading>{t('garden_rename')}</Heading>
              <Input
                label={t('garden_plant_name')}
                autoFocus
                maxLength={30}
                value={editing.plantName}
                onChangeText={(plantName) => setEditing((d) => (d ? { ...d, plantName } : d))}
              />
              <ColorPicker
                label={t('garden_pot_color')}
                value={editing.potColor}
                onChange={(potColor) => setEditing((d) => (d ? { ...d, potColor } : d))}
              />
              <View style={{ flexDirection: 'row', gap: th.spacing[3] }}>
                <Button variant="secondary" style={{ flex: 1 }} onPress={() => setEditing(null)}>
                  {t('cancel')}
                </Button>
                <Button
                  style={{ flex: 1 }}
                  loading={updatePlant.isPending}
                  onPress={() => {
                    if (!editing) return;
                    updatePlant.mutate({
                      plantName: editing.plantName.trim() || null,
                      potColor: editing.potColor,
                    });
                    setEditing(null);
                  }}
                >
                  {t('save')}
                </Button>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </Card>
  );
}

/**
 * One open assignment. Tapping the topic name opens it, because an assignment the student cannot
 * act on from where they read it is a chore.
 */
function AssignmentChip({ chip, today }: { chip: StudentAssignmentChip; today: string }) {
  const th = useTheme();
  const { t } = useLang();
  const done = chip.done >= chip.requiredCount;
  const urgent = !done && daysBetweenVn(today, chip.deadline) <= URGENT_DAYS;
  const modes = parseModes(chip.modes);

  return (
    <Pressable
      accessibilityRole="link"
      onPress={() =>
        router.push(`/vocabulary/${encodeURIComponent(chip.topicSlug ?? chip.topicId)}`)
      }
      style={{
        gap: th.spacing[2],
        padding: th.spacing[3],
        borderRadius: th.radius.md,
        backgroundColor: urgent ? th.category.rose.soft : th.color.surfaceSunken,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
        <Body style={{ flex: 1, fontFamily: th.font.bodyBold }} numberOfLines={1}>
          {chip.topicName}
        </Body>
        {done ? <Badge color="success">{t('garden_status_done')}</Badge> : null}
      </View>
      {modes ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[1] }}>
          {modes.map((m) => (
            <Badge key={m} color="violet">
              {t(`fc_mode_${m}`)}
            </Badge>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
        <Clock size={14} color={urgent ? th.category.rose.ink : th.color.textMuted} />
        <Muted style={urgent ? { color: th.category.rose.ink } : undefined}>
          {t('garden_deadline')}: {formatDmy(chip.deadline)}
        </Muted>
        <ProgressBar
          style={{ flex: 1 }}
          value={Math.round((Math.min(chip.done, chip.requiredCount) * 100) / chip.requiredCount)}
          color={done ? 'green' : 'brand'}
        />
        <Muted>
          {chip.done}/{chip.requiredCount}
        </Muted>
      </View>
    </Pressable>
  );
}
