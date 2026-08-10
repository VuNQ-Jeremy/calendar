import React from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import type { Href } from 'expo-router';
import * as api from './endpoints';

/**
 * Push notifications, device side.
 *
 * The capability that justifies shipping a native app at all: everything else here a good PWA
 * could have done. This module owns permission, the Expo token, the Android channels and the
 * tap-to-deep-link handler. The sending side is `server/services/notify.ts`.
 *
 * NOTE: none of this works in Expo Go. Use the `development` or `preview` APK.
 */

/**
 * Three channels, no more.
 *
 * Android groups notifications by channel and lets the user mute each one independently — which
 * is the point: someone who does not want study nudges can silence those without also losing
 * "your class starts in 30 minutes". A single channel would make that an all-or-nothing choice,
 * and the choice they would make is "nothing".
 *
 * Channels are created once and are immutable afterwards: Android ignores importance changes to
 * an existing channel id. Getting these wrong means shipping a new id, so they are deliberate.
 */
export const CHANNELS = [
  { id: 'reminders', name: 'Class reminders', importance: Notifications.AndroidImportance.HIGH },
  { id: 'study', name: 'Study nudges', importance: Notifications.AndroidImportance.LOW },
] as const;

/** The token last registered with the server, so logout can unregister exactly it. */
const TOKEN_KEY = 'mochi_push_token_v1';
/** Whether the contextual prompt has already had its one chance. */
const ASKED_KEY = 'mochi_push_asked_v1';

/** Foreground behaviour: show the banner. A muted foreground notification looks like a bug. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const c of CHANNELS) {
    await Notifications.setNotificationChannelAsync(c.id, {
      name: c.name,
      importance: c.importance,
      // Android tints the monochrome icon declared in app.config.ts; the light is ours to set.
      lightColor: '#F79A4E',
    });
  }
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function permissionState(): Promise<PermissionState> {
  const res = await Notifications.getPermissionsAsync();
  if (res.granted) return 'granted';
  // On Android 13+ a denial of POST_NOTIFICATIONS is STICKY: `canAskAgain` false means the only
  // route back is system settings, and the UI has to say so rather than re-prompting into a void.
  return res.canAskAgain ? 'undetermined' : 'denied';
}

/**
 * Ask, then register. Returns the resulting state so the caller can explain a denial.
 *
 * Only call this from somewhere the user has context for it — after a finished game, or on
 * opening a class. A cold prompt on first launch gets denied, and on Android 13+ that denial
 * cannot be undone from inside the app.
 */
export async function requestAndRegister(): Promise<PermissionState> {
  await AsyncStorage.setItem(ASKED_KEY, '1').catch(() => {});
  const existing = await Notifications.getPermissionsAsync();
  const res = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (!res.granted) return res.canAskAgain ? 'undetermined' : 'denied';

  await ensureChannels();
  await registerToken();
  return 'granted';
}

/**
 * Push the current Expo token to the server. Safe to call repeatedly.
 *
 * Called on every sign-in, not just the first: Expo tokens rotate, and the same handset serves
 * different accounts. The server upserts on the token, so re-registering MOVES it to the current
 * account rather than leaving a row that would deliver the previous user's notifications here.
 */
export async function registerToken(): Promise<string | null> {
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
    await api.push.register({ expoToken: token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch (err) {
    // Never fatal. A phone with no Play Services, or offline at sign-in, still has a working app.
    console.warn('[push] register failed', String(err));
    return null;
  }
}

/**
 * Tell the server to stop sending here, then forget the token.
 *
 * Must run BEFORE the session token is discarded — the unregister call is authenticated. That is
 * why `logout()` in lib/auth.tsx awaits this ahead of `endSession`.
 */
export async function unregisterToken(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) await api.push.unregister(token);
  } catch {
    // Signing out must succeed offline. The row is harmless until the next sign-in moves it.
  } finally {
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  }
}

/** Has the contextual prompt already been shown once? */
export async function hasBeenAsked(): Promise<boolean> {
  return (await AsyncStorage.getItem(ASKED_KEY).catch(() => null)) === '1';
}

/**
 * Spend the ask without opening the system dialog — what "Not now" does.
 *
 * Dismissing counts. Re-offering on every game end is how an app earns the permanent denial it
 * was trying to avoid; the Notifications screen stays available for a change of mind.
 */
export async function markAsked(): Promise<void> {
  await AsyncStorage.setItem(ASKED_KEY, '1').catch(() => {});
}

/**
 * Re-register on sign-in, when — and only when — permission is already granted.
 *
 * Deliberately does NOT prompt: this runs on every launch of a signed-in app, which is exactly
 * the cold, contextless moment the prompt must avoid.
 */
export function usePushRegistration(signedIn: boolean): void {
  React.useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      const state = await permissionState();
      if (cancelled || state !== 'granted') return;
      await ensureChannels();
      await registerToken();
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);
}

/**
 * Tapping a notification opens the thing it is about.
 *
 * Every message carries `data.url` (see server/services/notify.ts) — `/event/:id`,
 * `/flashcards`. A notification that opens the home screen is a notification people learn to
 * ignore.
 *
 * Both paths are handled: `getLastNotificationResponseAsync` for a tap that COLD-STARTED the app
 * (the listener is registered too late to see it), and the listener for a tap while it is
 * running. Miss the first and every notification tapped from a killed app lands on the dashboard.
 */
export function useNotificationRouting(ready: boolean): void {
  React.useEffect(() => {
    if (!ready) return;

    const go = (data: unknown) => {
      const payload = data as { url?: string; kind?: string } | undefined;
      // Garden alerts are wilt and stage-drop nudges about the student's OWN plant, so they land on
      // the vocabulary home, where the widget sits at the top — not on the class garden. Keyed on
      // `kind` rather than on the url, so the web keeps its own `/flashcards` destination and this
      // needs no server deploy (server/services/notify.ts sends `{url:'/flashcards', kind:'garden'}`).
      if (payload?.kind === 'garden') {
        router.push('/vocabulary' as Href);
        return;
      }
      // The tuition announcement is gone (fees are staff-only), but a phone can still be holding
      // one sent before the removal. Its `url` is '/profile', which still exists, so it lands
      // there rather than on +not-found — no special case needed.
      const url = payload?.url;
      if (typeof url !== 'string' || !url.startsWith('/')) return;
      // The vocabulary tab moved from /flashcards to /vocabulary. The server still sends the old
      // path so notification taps keep working on installs that predate the rename; remap it here
      // or expo-router lands on +not-found.
      const href =
        url === '/flashcards' || url.startsWith('/flashcards/')
          ? `/vocabulary${url.slice('/flashcards'.length)}`
          : url;
      router.push(href as Href);
    };

    let handled = false;
    void Notifications.getLastNotificationResponseAsync().then((res) => {
      if (handled || !res) return;
      handled = true;
      go(res.notification.request.content.data);
    });

    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      handled = true;
      go(res.notification.request.content.data);
    });
    return () => sub.remove();
  }, [ready]);
}
