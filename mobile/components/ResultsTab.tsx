import React from 'react';
import { ScrollView, View } from 'react-native';
import { fmtDuration } from '@mochi/shared/logic/flashcards';
import { useLang } from '~/lib/i18n';
import { shortDate } from '~/lib/format';
import { locale } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Avatar, Badge, Body, Card, Heading, Muted } from '~/ui';
import type { FlashcardResultRow } from '~/lib/types';

/**
 * Port of the Results tab in `src/flashcards/topic.tsx`: recent plays, then the leaderboard.
 *
 * Two rules carried over from the server's data model, both easy to get wrong:
 *   - `flashcard_results` has BOTH `student_id` and `staff_id`, each nullable, and exactly one is
 *     set per row. `isStaff` is how the API tells you which — staff plays are recorded on purpose.
 *   - **Staff are excluded from the leaderboard.** It is a student competition; a teacher
 *     test-driving a topic must not top the table.
 *
 * No charts here. The web's Results tab has none either — `src/components/charts.tsx` belongs to
 * the assessments screens, which are phase 5.
 */
export function ResultsTab({ results }: { results: FlashcardResultRow[] }) {
  const th = useTheme();
  const { t, lang } = useLang();

  const leaderboard = React.useMemo(() => {
    const best = new Map<string, { name: string; color: string; pct: number }>();
    for (const r of results) {
      if (r.isStaff) continue;
      const pct = Math.round((r.score * 100) / r.total);
      const cur = best.get(r.playerId);
      if (!cur || pct > cur.pct) {
        best.set(r.playerId, { name: r.playerName, color: r.playerColor, pct });
      }
    }
    return Array.from(best.values())
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 10);
  }, [results]);

  if (results.length === 0) {
    return (
      <View style={{ padding: th.spacing[4] }}>
        <Card>
          <Muted>{t('fc_no_results')}</Muted>
        </Card>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: th.spacing[4], gap: th.spacing[4], paddingBottom: th.spacing[10] }}>
      <Card style={{ gap: th.spacing[3] }}>
        <Heading>{t('fc_recent_plays')}</Heading>
        {results.slice(0, 25).map((r) => (
          <View
            key={r.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}
          >
            <Avatar name={r.playerName} color={r.playerColor} size="sm" />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
                <Body style={{ fontFamily: th.font.bodyMedium }} numberOfLines={1}>
                  {r.playerName}
                </Body>
                {r.isStaff ? <Badge color="orange">{t('fc_staff_badge')}</Badge> : null}
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: th.spacing[2],
                  flexWrap: 'wrap',
                }}
              >
                <Badge color="violet">{t(`fc_mode_${r.mode}`)}</Badge>
                <Muted>
                  {r.score}/{r.total} · {Math.round((r.score * 100) / r.total)}%
                </Muted>
                {r.durationMs != null ? <Muted>{fmtDuration(r.durationMs)}</Muted> : null}
                <Muted>{shortDate(r.playedAt, locale(lang))}</Muted>
              </View>
            </View>
          </View>
        ))}
      </Card>

      {leaderboard.length > 0 ? (
        <Card style={{ gap: th.spacing[3] }}>
          <Heading>{t('fc_leaderboard')}</Heading>
          {leaderboard.map((s, i) => (
            <View
              key={`${s.name}-${i}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}
            >
              <Muted style={{ width: 20, fontFamily: th.font.bodyBold }}>{i + 1}</Muted>
              <Avatar name={s.name} color={s.color} size="sm" />
              <Body style={{ flex: 1, fontFamily: th.font.bodyMedium }} numberOfLines={1}>
                {s.name}
              </Body>
              <Body style={{ fontFamily: th.font.bodyBold }}>{s.pct}%</Body>
            </View>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}
