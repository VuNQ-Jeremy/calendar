import { Pressable, View } from 'react-native';
import { Link, router } from 'expo-router';
import type { Href } from 'expo-router';
import {
  BarChart3,
  Bell,
  ChevronRight,
  ClipboardList,
  FolderOpen,
  Languages,
  LogOut,
  MessageSquare,
  Send,
  Settings,
  UserRound,
  Users,
} from 'lucide-react-native';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { versionStamp } from '~/lib/version';
import { useTheme, TOUCH } from '~/theme';
import { Body, Card, Mono, Muted, Screen, Title } from '~/ui';

/**
 * Everything that does not fit in five tabs.
 *
 * Mirrors the `NAV` const in `app/routes/_app.tsx`, including its `adminOnly` flag on Config.
 * That gate is cosmetic — `/api/assessment-types*` is admin-level and returns 403 to a Teacher
 * token regardless — but a row that always errors is worse than no row.
 */

interface Row {
  key: string;
  tk: string;
  href?: Href;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

export default function More() {
  const th = useTheme();
  const { t } = useLang();
  const { user, account, logout } = useAuth();

  const iconColor = th.color.textMuted;
  const rows: Row[] = [
    { key: 'people', tk: 'nav_people', href: '/people', icon: <Users size={20} color={iconColor} /> },
    {
      key: 'homework',
      tk: 'nav_homework',
      href: '/homework',
      icon: <ClipboardList size={20} color={iconColor} />,
    },
    {
      key: 'materials',
      tk: 'nav_materials',
      href: '/materials',
      icon: <FolderOpen size={20} color={iconColor} />,
    },
    {
      key: 'assessments',
      tk: 'nav_assessments',
      href: '/assessments',
      icon: <BarChart3 size={20} color={iconColor} />,
    },
    {
      key: 'feedback',
      tk: 'nav_feedback',
      href: '/feedback',
      icon: <MessageSquare size={20} color={iconColor} />,
    },
    {
      // The web puts "Give feedback" in the sidebar, opening a modal from the app shell. A phone
      // has no persistent shell, so the compose form is a query param on the inbox screen.
      key: 'feedback_send',
      tk: 'fb_share',
      href: '/feedback?compose=1',
      icon: <Send size={20} color={iconColor} />,
    },
    {
      key: 'config',
      tk: 'nav_config',
      href: '/config',
      icon: <Settings size={20} color={iconColor} />,
      adminOnly: true,
    },
    {
      key: 'profile',
      tk: 'prof_title',
      href: '/profile',
      icon: <UserRound size={20} color={iconColor} />,
    },
    {
      key: 'notifications',
      tk: 'm_notifications',
      href: '/notifications',
      icon: <Bell size={20} color={iconColor} />,
    },
    {
      key: 'language',
      tk: 'language',
      href: '/language',
      icon: <Languages size={20} color={iconColor} />,
    },
  ];

  const visible = rows.filter((r) => !r.adminOnly || user?.role === 'Admin');

  return (
    // `top`, because this screen has no ScreenHeader to own the status-bar inset — the title is
    // the first thing in it, and on an edge-to-edge Android it renders under the clock otherwise.
    <Screen scroll edges={{ top: true }}>
      <Title>{t('m_more')}</Title>

      {account ? (
        <Muted>
          {t('m_signed_in_as')} {account.email}
        </Muted>
      ) : null}

      <Card flat style={{ padding: 0, overflow: 'hidden' }}>
        {visible.map((row, i) => (
          <Link key={row.key} href={row.href!} asChild>
            <Pressable
              accessibilityRole="link"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: th.spacing[4],
                minHeight: TOUCH + 4,
                paddingHorizontal: th.spacing[5],
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: th.color.borderSubtle,
                backgroundColor: pressed ? th.color.surfaceHover : 'transparent',
              })}
            >
              {row.icon}
              <Body style={{ flex: 1 }}>{t(row.tk)}</Body>
              {row.adminOnly ? <Muted style={{ fontSize: 11 }}>{t('m_admin_only')}</Muted> : null}
              <ChevronRight size={18} color={th.color.textDisabled} />
            </Pressable>
          </Link>
        ))}

        <Pressable
          accessibilityRole="button"
          onPress={() => void logout()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: th.spacing[4],
            minHeight: TOUCH + 4,
            paddingHorizontal: th.spacing[5],
            borderTopWidth: 1,
            borderTopColor: th.color.borderSubtle,
            backgroundColor: pressed ? th.color.surfaceHover : 'transparent',
          })}
        >
          <LogOut size={20} color={th.status.danger} />
          <Body style={{ flex: 1, color: th.status.danger }}>{t('prof_logout')}</Body>
        </Pressable>
      </Card>

      {/*
        Stated, not silently dropped: the web's scrollbar-style preference has no Android
        equivalent (there is no styleable scrollbar to apply it to). A user who set it on the web
        and comes looking for it here gets an answer instead of concluding the app is incomplete.
        Full list of deliberate omissions: docs/mobile-parity.md.
      */}
      <Muted style={{ paddingHorizontal: th.spacing[2] }}>{t('m_web_only_note')}</Muted>

      {/*
        The build stamp: v0.00NN · rtN · <sha> · <updateId>.
        With OTA updates this is the ONLY way to know which bundle a phone is running — the
        installed APK's version and the JS actually executing diverge the moment an update
        ships. Tapping it opens the feedback screen, where the same string is attached to the
        report via FeedbackInput.appVersion.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('m_version')}
        onPress={() => router.push('/feedback')}
        style={{ alignItems: 'center', paddingVertical: th.spacing[4] }}
      >
        <Mono>{versionStamp()}</Mono>
      </Pressable>

      <View style={{ height: th.spacing[4] }} />
    </Screen>
  );
}
