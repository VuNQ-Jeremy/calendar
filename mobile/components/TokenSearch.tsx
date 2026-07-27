import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import { useLang } from '~/lib/i18n';
import { useTheme, TOUCH } from '~/theme';
import { Body, Muted } from '~/ui';
import { SearchField, matches } from './SearchField';

export interface TokenItem {
  id: string;
  name: string;
  color?: string | null;
}

/**
 * Type-ahead multi-select: the mobile counterpart of `TokenSearch` in
 * `src/screens-manage/people.tsx`.
 *
 * The web version renders its dropdown through `createPortal` into `document.body`, positioned
 * with `getBoundingClientRect` and re-placed on every scroll and resize — all of which exists to
 * escape the modal's overflow clipping. None of that ports, and none of it is needed: on a phone
 * the field owns the screen it is on, so the matches render inline underneath it in a bounded
 * scroll area. No portal, no measurement, no scroll listener.
 *
 * Selected items stay above the field as removable chips, exactly as on the web — a chip is both
 * the state and the remove control, and it is the one part of the interaction a fingertip
 * handles better than a mouse.
 */
export function TokenSearch({
  label,
  items,
  selectedIds,
  onToggle,
  placeholder,
  emptyHint,
}: {
  label?: string;
  items: TokenItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  placeholder: string;
  emptyHint: string;
}) {
  const th = useTheme();
  const { t } = useLang();
  const [q, setQ] = React.useState('');

  const selected = items.filter((i) => selectedIds.includes(i.id));
  const unselected = items.filter((i) => !selectedIds.includes(i.id));
  const shown = unselected.filter((i) => matches(q, i.name));

  const catOf = (color: string | null | undefined) =>
    color && color in th.category ? th.category[color as keyof typeof th.category] : null;

  return (
    <View style={{ gap: th.spacing[3] }}>
      {label ? (
        <Body style={{ fontFamily: th.font.bodyBold, fontSize: th.text.sm.fontSize }}>{label}</Body>
      ) : null}

      {selected.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[2] }}>
          {selected.map((i) => {
            const cat = catOf(i.color);
            return (
              <Pressable
                key={i.id}
                accessibilityRole="button"
                accessibilityLabel={`${t('remove')} ${i.name}`}
                onPress={() => onToggle(i.id)}
                hitSlop={6}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: th.spacing[2],
                  minHeight: 36,
                  paddingLeft: th.spacing[4],
                  paddingRight: th.spacing[3],
                  borderRadius: th.radius.pill,
                  borderWidth: 1.5,
                  borderColor: cat ? cat.base : th.color.borderStrong,
                  backgroundColor: cat ? cat.soft : th.color.surfaceSunken,
                }}
              >
                <Body
                  style={{
                    fontFamily: th.font.bodyMedium,
                    fontSize: th.text.sm.fontSize,
                    color: cat ? cat.ink : th.color.textBody,
                  }}
                >
                  {i.name}
                </Body>
                <X size={14} color={cat ? cat.ink : th.color.textMuted} />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <SearchField value={q} onChange={setQ} placeholder={placeholder} />

      {shown.length ? (
        // Bounded height: an unbounded list of 200 students inside a form would push the save
        // button somewhere no one will scroll to.
        <ScrollView
          style={{
            maxHeight: 5 * TOUCH,
            borderWidth: 1.5,
            borderColor: th.color.borderSubtle,
            borderRadius: th.radius.md,
            backgroundColor: th.color.surfaceCard,
          }}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {shown.map((i, idx) => {
            const cat = catOf(i.color);
            return (
              <Pressable
                key={i.id}
                accessibilityRole="button"
                accessibilityLabel={i.name}
                onPress={() => {
                  onToggle(i.id);
                  setQ('');
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: th.spacing[3],
                  minHeight: TOUCH,
                  paddingHorizontal: th.spacing[4],
                  borderTopWidth: idx === 0 ? 0 : 1,
                  borderTopColor: th.color.borderSubtle,
                  backgroundColor: pressed ? th.color.surfaceHover : 'transparent',
                })}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: cat ? cat.base : th.ramp.taupe[400],
                  }}
                />
                <Body style={{ flex: 1 }} numberOfLines={1}>
                  {i.name}
                </Body>
                <Plus size={18} color={th.color.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <Muted>{q.trim() ? t('ts_no_match', { q }) : emptyHint}</Muted>
      )}
    </View>
  );
}
