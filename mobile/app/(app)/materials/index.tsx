import React from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { Download, ExternalLink, Pencil, Plus, Star, Trash2 } from 'lucide-react-native';
import { ScreenHeader } from '~/components/ScreenHeader';
import { SearchField, matches } from '~/components/SearchField';
import { ChipSelect } from '~/components/ChipSelect';
import { useLang } from '~/lib/i18n';
import { MAT_TYPES, MAT_TYPE_IDS, isLinkType } from '~/lib/mat-types';
import {
  useAllClassMaterials,
  useClasses,
  useMaterialMutations,
  useMaterials,
  useInvalidateStaff,
} from '~/lib/staff-data';
import type { MaterialRow } from '~/lib/types';
import { useTheme } from '~/theme';
import { Body, Button, Card, Heading, IconButton, Muted, Screen, Switch, Tag } from '~/ui';

/**
 * Task 5.2 — the material library.
 *
 * Port of `MaterialsScreen` in `src/screens-extra.tsx`, minus its three-column card grid: at
 * 360dp a "grid" is one column, so this is a list. The filters the web puts in a toolbar
 * (class, type, favourites-only) become a search box, a chip row and a switch, in that order of
 * how often they get used on a phone.
 *
 * Opening a material goes to the phase-4 viewer at `/material/:id`, which handles the docx and
 * PDF hand-off. Editing goes to `/materials/:id` in this stack.
 */
export default function Materials() {
  const th = useTheme();
  const { t } = useLang();
  const invalidate = useInvalidateStaff();

  const { data: materials, isLoading, isRefetching } = useMaterials();
  const { data: classes } = useClasses();
  // A material can be filed under several classes, so the chips and the class filter read the
  // join rather than a column on the row.
  const { data: links } = useAllClassMaterials();
  const { remove, toggleFavorite } = useMaterialMutations();

  const [q, setQ] = React.useState('');
  const [type, setType] = React.useState('all');
  const [classId, setClassId] = React.useState('all');
  const [favOnly, setFavOnly] = React.useState(false);

  const shown = (materials ?? []).filter(
    (m) =>
      matches(q, m.title, m.fileName, m.url) &&
      (type === 'all' || m.type === type) &&
      (classId === 'all' ||
        (links ?? []).some((l) => l.materialId === m.id && l.classId === classId)) &&
      (!favOnly || m.favorite),
  );

  const classesOf = (id: string) =>
    (links ?? [])
      .filter((l) => l.materialId === id)
      .map((l) => classes?.find((c) => c.id === l.classId))
      .filter((c): c is NonNullable<typeof c> => !!c);

  const confirmDelete = (m: MaterialRow) =>
    Alert.alert(t('delete'), m.title, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => remove.mutate(m.id) },
    ]);

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={t('mat_title')} subtitle={t('mat_sub')} />

      <View style={{ padding: th.spacing[4], gap: th.spacing[3] }}>
        <SearchField value={q} onChange={setQ} placeholder={t('mat_search_ph')} />
        <ChipSelect
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: t('mat_all_types') },
            ...MAT_TYPE_IDS.map((k) => ({ value: k, label: t(MAT_TYPES[k].tk) })),
          ]}
        />
        <ChipSelect
          value={classId}
          onChange={setClassId}
          options={[
            { value: 'all', label: t('mat_all_classes') },
            ...(classes ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Switch checked={favOnly} onChange={setFavOnly} label={t('mat_fav_only')} />
      </View>

      <FlashList
        data={shown}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: th.spacing[4], paddingBottom: th.spacing[10] }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void invalidate()}
            tintColor={th.color.brand}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: th.spacing[3], paddingBottom: th.spacing[3] }}>
            <Button
              block
              iconLeft={<Plus size={18} color={th.color.textOnBrand} />}
              onPress={() => router.push('/materials/new')}
            >
              {t('mat_add')}
            </Button>
            {isLoading && !materials ? <ActivityIndicator color={th.color.brand} /> : null}
          </View>
        }
        ListEmptyComponent={
          isLoading && !materials ? null : (
            <Card>
              <Heading>{t('mat_none_title')}</Heading>
              <Muted>{t('mat_none_sub')}</Muted>
            </Card>
          )
        }
        renderItem={({ item: m }) => {
          const mt = MAT_TYPES[m.type] ?? MAT_TYPES.notes;
          const Icon = mt.icon;
          const linked = classesOf(m.id);
          const cat = th.category[mt.color as keyof typeof th.category];
          const link = isLinkType(m.type);

          return (
            <Card
              flat
              style={{ padding: th.spacing[4], gap: th.spacing[3], marginBottom: th.spacing[2] }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: th.spacing[3] }}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: th.radius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: cat.soft,
                  }}
                >
                  <Icon size={20} color={cat.ink} />
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={m.title}
                  onPress={() => router.push(`/material/${m.id}`)}
                  style={{ flex: 1, minWidth: 0, gap: th.spacing[2] }}
                >
                  <Body style={{ fontFamily: th.font.bodyBold }} numberOfLines={2}>
                    {m.title}
                  </Body>
                  <View style={{ flexDirection: 'row', gap: th.spacing[1], flexWrap: 'wrap' }}>
                    <Tag>{t(mt.tk)}</Tag>
                    {linked.length ? (
                      linked.map((c) => (
                        <Tag key={c.id} dot color={c.color}>
                          {c.name}
                        </Tag>
                      ))
                    ) : (
                      <Tag dot>{t('mat_unfiled')}</Tag>
                    )}
                  </View>
                </Pressable>

                {/*
                  Optimistic: `toggleFavorite` writes the cache before the request lands, so the
                  star fills on touch rather than a round trip later.
                */}
                <IconButton
                  label={t('mat_fav_only')}
                  onPress={() => toggleFavorite.mutate({ id: m.id, favorite: !m.favorite })}
                >
                  <Star
                    size={20}
                    color={m.favorite ? th.color.brand : th.color.textDisabled}
                    fill={m.favorite ? th.color.brand : 'transparent'}
                  />
                </IconButton>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
                <Button
                  variant="soft"
                  onPress={() => router.push(`/material/${m.id}`)}
                  iconLeft={
                    link ? (
                      <ExternalLink size={15} color={th.color.brandSoftInk} />
                    ) : (
                      <Download size={15} color={th.color.brandSoftInk} />
                    )
                  }
                >
                  {link ? t('mat_open_link') : t('open_label')}
                </Button>
                <View style={{ flex: 1 }} />
                <IconButton label={t('edit')} onPress={() => router.push(`/materials/${m.id}`)}>
                  <Pencil size={18} color={th.color.textMuted} />
                </IconButton>
                <IconButton label={t('delete')} onPress={() => confirmDelete(m)}>
                  <Trash2 size={18} color={th.status.danger} />
                </IconButton>
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}
