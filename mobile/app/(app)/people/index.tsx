import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import type { Href } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { ChevronRight, Plus } from 'lucide-react-native';
import { InvitesPanel } from '~/components/InvitesPanel';
import { ScreenHeader } from '~/components/ScreenHeader';
import { SearchField, matches } from '~/components/SearchField';
import { useLang } from '~/lib/i18n';
import {
  useClasses,
  useInvites,
  useParents,
  useStaff,
  useStudents,
  useInvalidateStaff,
} from '~/lib/staff-data';
import { useTheme, TOUCH } from '~/theme';
import { Avatar, Badge, Body, Button, Card, Heading, Muted, Screen, Tabs, Tag } from '~/ui';

/**
 * Task 5.1 — People.
 *
 * The web's `StudentsScreen` is one 1049-line component covering students, staff, parents and
 * invites, with create/update/delete for each. This is the list half of it; the editors are
 * pushed screens under `people/`.
 *
 * Search is in the header and always visible. On the web it is a 240px input in a toolbar that
 * a user can ignore because the whole table is on screen; on a phone, with eight rows visible
 * at a time, it is how anyone finds anyone.
 */

type TabId = 'students' | 'staff' | 'parents' | 'invites';

export default function People() {
  const th = useTheme();
  const { t } = useLang();
  const invalidate = useInvalidateStaff();

  const students = useStudents();
  const staff = useStaff();
  const parents = useParents();
  const invites = useInvites();
  const { data: classes } = useClasses();

  const [tab, setTab] = React.useState<TabId>('students');
  const [q, setQ] = React.useState('');

  const loading =
    (students.isLoading && !students.data) ||
    (staff.isLoading && !staff.data) ||
    (parents.isLoading && !parents.data);
  const refreshing =
    students.isRefetching || staff.isRefetching || parents.isRefetching || invites.isRefetching;

  const classNames = (ids: string[]) =>
    (classes ?? []).filter((c) => ids.includes(c.id)).map((c) => c.name);

  const shownStudents = (students.data ?? []).filter((s) =>
    matches(q, s.name, s.grade, s.guardian, s.email),
  );
  const shownStaff = (staff.data ?? []).filter((u) => matches(q, u.name, u.email, u.phone, u.role));
  const shownParents = (parents.data ?? []).filter((p) =>
    matches(q, p.name, p.email, p.phone, p.relation),
  );

  const addHref: Record<Exclude<TabId, 'invites'>, Href> = {
    students: '/people/student/new',
    staff: '/people/staff/new',
    parents: '/people/parent/new',
  };
  const addLabel: Record<Exclude<TabId, 'invites'>, string> = {
    students: 'ppl_add_student',
    staff: 'ppl_add_staff',
    parents: 'ppl_add_parent',
  };

  const header = (
    <View style={{ gap: th.spacing[3], paddingBottom: th.spacing[3] }}>
      {tab === 'invites' ? null : (
        <Button
          block
          iconLeft={<Plus size={18} color={th.color.textOnBrand} />}
          onPress={() => router.push(addHref[tab])}
        >
          {t(addLabel[tab])}
        </Button>
      )}

      {loading ? <ActivityIndicator color={th.color.brand} /> : null}
    </View>
  );

  const empty = (title: string, sub?: string) => (
    <Card>
      <Heading>{q.trim() ? t('ppl_no_match', { q }) : title}</Heading>
      {!q.trim() && sub ? <Muted>{sub}</Muted> : null}
    </Card>
  );

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={t('ppl_title')} subtitle={t('ppl_sub')} />

      <View style={{ padding: th.spacing[4], gap: th.spacing[3] }}>
        <SearchField value={q} onChange={setQ} placeholder={t('ppl_search_ph')} />
        <Tabs
          value={tab}
          onChange={(id) => setTab(id as TabId)}
          tabs={[
            { id: 'students', label: t('ppl_tab_students', { n: students.data?.length ?? 0 }) },
            { id: 'staff', label: t('ppl_tab_staff', { n: staff.data?.length ?? 0 }) },
            { id: 'parents', label: t('ppl_tab_parents', { n: parents.data?.length ?? 0 }) },
            {
              id: 'invites',
              label: t('ppl_tab_invites', {
                n: (invites.data ?? []).filter((i) => !i.used).length,
              }),
            },
          ]}
        />
      </View>

      {/*
        FlashList, not a ScrollView: a school's student list is the one collection in this app
        with no natural upper bound, and a ScrollView renders every row up front.
      */}
      {tab === 'students' ? (
        <FlashList
          data={shownStudents}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: th.spacing[4], paddingBottom: th.spacing[10] }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void invalidate()}
              tintColor={th.color.brand}
            />
          }
          ListHeaderComponent={header}
          ListEmptyComponent={loading ? null : empty(t('ppl_no_students'), t('ppl_no_students_sub'))}
          renderItem={({ item: s }) => (
            <PersonRow
              name={s.name}
              color={s.color}
              meta={[s.grade ? t('ppl_grade', { g: s.grade }) : null, s.guardian, s.email]}
              tags={classNames(s.classIds)}
              onPress={() => router.push(`/people/student/${s.id}`)}
            />
          )}
        />
      ) : null}

      {tab === 'staff' ? (
        <FlashList
          data={shownStaff}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ paddingHorizontal: th.spacing[4], paddingBottom: th.spacing[10] }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void invalidate()}
              tintColor={th.color.brand}
            />
          }
          ListHeaderComponent={header}
          ListEmptyComponent={loading ? null : empty(t('ppl_no_staff'), t('ppl_no_staff_sub'))}
          renderItem={({ item: u }) => (
            <PersonRow
              name={u.name}
              color={u.color}
              meta={[u.email, u.phone]}
              badge={{
                label: t(`role_${String(u.role).toLowerCase()}`),
                color: u.role === 'Admin' ? 'brand' : 'violet',
              }}
              onPress={() => router.push(`/people/staff/${u.id}`)}
            />
          )}
        />
      ) : null}

      {tab === 'parents' ? (
        <FlashList
          data={shownParents}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: th.spacing[4], paddingBottom: th.spacing[10] }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void invalidate()}
              tintColor={th.color.brand}
            />
          }
          ListHeaderComponent={header}
          ListEmptyComponent={loading ? null : empty(t('ppl_no_parents'), t('ppl_no_parents_sub'))}
          renderItem={({ item: p }) => {
            const kids = (students.data ?? []).filter((s) => (p.studentIds ?? []).includes(s.id));
            return (
              <PersonRow
                name={p.name}
                color={p.color}
                meta={[p.email, p.phone]}
                tags={kids.length ? kids.map((s) => s.name) : [t('ppl_no_children')]}
                badge={{
                  label: t(`rel_${String(p.relation ?? 'guardian').toLowerCase()}`),
                  color: 'green',
                }}
                onPress={() => router.push(`/people/parent/${p.id}`)}
              />
            );
          }}
        />
      ) : null}

      {tab === 'invites' ? <InvitesPanel query={q} /> : null}
    </Screen>
  );
}

/**
 * One person, as a tappable row. Everything the web puts in a table row minus the inline edit and
 * delete buttons — those live on the detail screen, because three 48dp targets side by side on a
 * 360dp row leaves no room for a Vietnamese name.
 */
function PersonRow({
  name,
  color,
  meta,
  tags,
  badge,
  onPress,
}: {
  name: string;
  color?: string | null;
  meta: (string | null | undefined)[];
  tags?: string[];
  badge?: { label: string; color: string };
  onPress: () => void;
}) {
  const th = useTheme();
  const metaLine = meta.filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: th.spacing[3],
        minHeight: TOUCH + 12,
        paddingVertical: th.spacing[3],
        paddingHorizontal: th.spacing[3],
        marginBottom: th.spacing[2],
        borderRadius: th.radius.lg,
        borderWidth: 1.5,
        borderColor: th.color.borderSubtle,
        backgroundColor: pressed ? th.color.surfaceHover : th.color.surfaceCard,
      })}
    >
      <Avatar name={name} color={color} size="md" />

      <View style={{ flex: 1, minWidth: 0, gap: th.spacing[1] }}>
        <Body style={{ fontFamily: th.font.bodyBold }} numberOfLines={1}>
          {name}
        </Body>
        {metaLine ? <Muted numberOfLines={1}>{metaLine}</Muted> : null}
        {tags?.length ? (
          <View style={{ flexDirection: 'row', gap: th.spacing[1], flexWrap: 'wrap' }}>
            {/* Three, then a count — the same truncation the web row uses. */}
            {tags.slice(0, 3).map((n, i) => (
              <Tag key={`${n}-${i}`}>{n}</Tag>
            ))}
            {tags.length > 3 ? <Tag>{`+${tags.length - 3}`}</Tag> : null}
          </View>
        ) : null}
      </View>

      {badge ? <Badge color={badge.color}>{badge.label}</Badge> : null}
      <ChevronRight size={18} color={th.color.textDisabled} />
    </Pressable>
  );
}
