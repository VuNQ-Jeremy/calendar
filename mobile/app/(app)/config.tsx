import React from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react-native';
import { DragReorderList } from '~/components/DragReorderList';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import * as api from '~/lib/endpoints';
import { useAssessmentTypes, useInvalidateStaff } from '~/lib/staff-data';
import type { AssessmentTypeRow } from '~/lib/types';
import { useTheme } from '~/theme';
import { Badge, Body, Button, Card, Heading, IconButton, Input, Muted, Screen } from '~/ui';

/**
 * Task 5.4 — System config. Admin only.
 *
 * Two gates, and both are needed. This screen checks `user.role === 'Admin'` and the More list
 * hides the row; the API independently returns 403 to a Teacher token (`requireApiAdmin`). The
 * client-side gate is not security — it is the difference between "this is not for you" and a
 * screen that loads and then errors.
 *
 * **The scrollbar-style preference is deliberately not here.** `uiPrefs.scrollbar` styles a
 * desktop scrollbar; Android's is not styleable, so the setting cannot do anything on a phone.
 * The value is left untouched so the web keeps working, and the omission is stated in the More
 * screen rather than silently dropped — see docs/mobile-parity.md.
 */
const ROW_HEIGHT = 64;

export default function Config() {
  const th = useTheme();
  const { t } = useLang();
  const { user } = useAuth();
  const invalidate = useInvalidateStaff();

  const { data: types, isLoading } = useAssessmentTypes();
  const [draft, setDraft] = React.useState<{ id?: string; name: string } | null>(null);
  /** Set while a reorder is in flight, so the list shows the dragged order, not the server's. */
  const [localOrder, setLocalOrder] = React.useState<string[] | null>(null);

  const save = useMutation({
    mutationFn: (d: { id?: string; name: string }) =>
      d.id
        ? api.assessmentTypes.update(d.id, { name: d.name })
        : // `active` has a Zod default, but the inferred INPUT type still requires it — the
          // schema's output is what the client types against. A new type is always active.
          api.assessmentTypes.create({ name: d.name, active: true }),
    onSuccess: () => {
      setDraft(null);
      void invalidate();
    },
    onError: () => Alert.alert(t('err_generic_title'), t('cfg_duplicate')),
  });

  const toggleActive = useMutation({
    mutationFn: (tp: AssessmentTypeRow) => api.assessmentTypes.update(tp.id, { active: !tp.active }),
    onSuccess: () => void invalidate(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.assessmentTypes.remove(id),
    onSuccess: () => void invalidate(),
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.reorderAssessmentTypes(ids),
    onSuccess: () => void invalidate(),
    // Clear the optimistic order only once the refetch has landed, so the rows never flash back
    // to the old positions in between.
    onSettled: () => setLocalOrder(null),
  });

  if (user?.role !== 'Admin') {
    return (
      <Screen edges={{ top: true }}>
        <ScreenHeader title={t('cfg_title')} />
        <View style={{ padding: th.spacing[5] }}>
          <Card>
            <Heading>{t('err_forbidden_title')}</Heading>
            <Muted>{t('cfg_admin_only_msg')}</Muted>
          </Card>
        </View>
      </Screen>
    );
  }

  // Same shape as the web's `ordered` memo: the optimistic order first, then anything the server
  // knows about that the drag did not (a type created on another device mid-drag).
  const ordered: AssessmentTypeRow[] = React.useMemo(() => {
    const rows = types ?? [];
    if (!localOrder) return rows;
    const byId = new Map(rows.map((tp) => [tp.id, tp]));
    const out = localOrder.flatMap((id) => byId.get(id) ?? []);
    for (const tp of rows) if (!localOrder.includes(tp.id)) out.push(tp);
    return out;
  }, [types, localOrder]);

  const confirmDelete = (tp: AssessmentTypeRow) =>
    Alert.alert(t('cfg_delete_q'), t('cfg_delete_msg', { name: tp.name }), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => remove.mutate(tp.id) },
    ]);

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={t('cfg_title')} subtitle={t('cfg_sub')} />

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[4], gap: th.spacing[4] }}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={{ gap: th.spacing[3] }}>
          <Heading>{t('cfg_types_title')}</Heading>
          <Muted>{t('cfg_drag_reorder_touch')}</Muted>

          <Button
            block
            iconLeft={<Plus size={18} color={th.color.textOnBrand} />}
            onPress={() => setDraft({ name: '' })}
          >
            {t('cfg_add_type')}
          </Button>

          {draft ? (
            <View style={{ gap: th.spacing[3] }}>
              <Input
                label={t('cfg_type_name')}
                value={draft.name}
                onChangeText={(v) => setDraft({ ...draft, name: v })}
                autoFocus
              />
              <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
                <Button variant="secondary" style={{ flex: 1 }} onPress={() => setDraft(null)}>
                  {t('cancel')}
                </Button>
                <Button
                  style={{ flex: 1 }}
                  disabled={!draft.name.trim()}
                  loading={save.isPending}
                  onPress={() => save.mutate({ ...draft, name: draft.name.trim() })}
                >
                  {t('save')}
                </Button>
              </View>
            </View>
          ) : null}
        </Card>

        {isLoading && !types ? <ActivityIndicator color={th.color.brand} /> : null}

        {types && !ordered.length ? (
          <Card>
            <Heading>{t('cfg_no_types')}</Heading>
          </Card>
        ) : null}

        <DragReorderList
          data={ordered}
          rowHeight={ROW_HEIGHT}
          gap={8}
          onReorder={(ids) => {
            setLocalOrder(ids);
            reorder.mutate(ids);
          }}
          renderRow={(tp, dragging) => (
            <View
              style={{
                height: ROW_HEIGHT,
                flexDirection: 'row',
                alignItems: 'center',
                gap: th.spacing[2],
                paddingHorizontal: th.spacing[3],
                borderRadius: th.radius.lg,
                borderWidth: 1.5,
                borderColor: dragging ? th.color.brand : th.color.borderSubtle,
                backgroundColor: th.color.surfaceCard,
              }}
            >
              <GripVertical size={18} color={th.color.textDisabled} />

              <View style={{ flex: 1, minWidth: 0 }}>
                <Body style={{ fontFamily: th.font.bodyBold }} numberOfLines={1}>
                  {tp.name}
                </Body>
              </View>

              <Badge color={tp.active ? 'success' : undefined}>
                {tp.active ? t('cfg_active') : t('cfg_inactive')}
              </Badge>

              <IconButton
                label={tp.active ? t('cfg_deactivate') : t('cfg_activate')}
                size="sm"
                onPress={() => toggleActive.mutate(tp)}
              >
                <Body style={{ fontSize: th.text.xs.fontSize, color: th.color.textMuted }}>
                  {tp.active ? t('cfg_off_short') : t('cfg_on_short')}
                </Body>
              </IconButton>
              <IconButton
                label={t('cfg_rename')}
                size="sm"
                onPress={() => setDraft({ id: tp.id, name: tp.name })}
              >
                <Pencil size={16} color={th.color.textMuted} />
              </IconButton>
              <IconButton label={t('delete')} size="sm" onPress={() => confirmDelete(tp)}>
                <Trash2 size={16} color={th.status.danger} />
              </IconButton>
            </View>
          )}
        />

        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}
