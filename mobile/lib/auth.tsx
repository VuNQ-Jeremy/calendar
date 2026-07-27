import React from 'react';
import * as SecureStore from 'expo-secure-store';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ApiError, configureApi } from './api';
import * as api from './endpoints';
import { unregisterToken } from './push';
import type { AuthAccount, AuthUser } from './types';
import type { LoginInput, RedeemInviteInput } from '@mochi/shared/schemas';

/**
 * Session state for the whole app.
 *
 * The token lives in expo-secure-store, which is backed by the Android Keystore. NEVER
 * AsyncStorage: that is a plaintext file in the app sandbox, readable on a rooted device or
 * from an `adb backup`. A 90-day session token is worth protecting.
 */

const TOKEN_KEY = 'mochi_session_token';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

interface AuthCtxValue {
  status: AuthStatus;
  user: AuthUser | null;
  account: AuthAccount | null;
  /** Set when a session ended on the server (password change elsewhere, expiry, revocation). */
  expired: boolean;
  login: (input: LoginInput) => Promise<void>;
  redeemInvite: (input: RedeemInviteInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-reads /api/auth/me. Call after a profile edit so the header name updates. */
  refresh: () => Promise<void>;
}

const AuthCtx = React.createContext<AuthCtxValue | null>(null);

/**
 * Read outside React, by the API client. Module-level rather than context state because
 * `apiFetch` needs the token on every request and cannot be a hook.
 */
let cachedToken: string | null = null;

async function readToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

/**
 * Wired at module load so no request can ever fire before the API client knows how to read a
 * token or what to do with a 401. The provider fills in `unauthorizedHandler` below; until it
 * does, a 401 simply has no side effect beyond the thrown ApiError.
 */
let unauthorizedHandler: (() => void) | null = null;
configureApi({ getToken: readToken, onUnauthorized: () => unauthorizedHandler?.() });

/**
 * The session token, for the two consumers that cannot go through `apiFetch`: the WebView that
 * renders `/materials/:id/view` and `File.downloadFileAsync`, both of which need to set the
 * `Authorization` header themselves. Everything else must use `~/lib/endpoints`.
 */
export const getToken = readToken;

async function writeToken(token: string | null): Promise<void> {
  cachedToken = token;
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // A device with no keystore is not a device we can hold a session on. Staying signed out
    // is the correct failure — better than silently downgrading to plaintext storage.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = React.useState<AuthStatus>('loading');
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [account, setAccount] = React.useState<AuthAccount | null>(null);
  const [expired, setExpired] = React.useState(false);

  /**
   * The single 401 handler for the entire app, wired into the API client once.
   *
   * Changing your password on the web deletes every OTHER session for the account
   * (server/services/auth.ts) — so the phone's next request 401s. That is correct security
   * behavior, and this is what makes it present as "please sign in again" instead of a crash.
   */
  const endSession = React.useCallback(
    (opts: { expired: boolean }) => {
      void writeToken(null);
      setUser(null);
      setAccount(null);
      setExpired(opts.expired);
      setStatus('signed-out');
      // Mirrors clearCache() in the web's logout clientAction: another account must never see
      // the previous one's cached roster.
      qc.clear();
      // `router` rather than a <Redirect/>: this can fire from a fetch deep inside a screen,
      // outside any render pass. The root layout guard handles the render-time case.
      if (router.canDismiss()) router.dismissAll();
      router.replace('/login');
    },
    [qc],
  );

  // Keep the module-level 401 hook pointed at the live closure. Assigned during render rather
  // than in an effect so it is in place before the hydrate effect below fires its first fetch.
  unauthorizedHandler = () => endSession({ expired: true });

  const hydrate = React.useCallback(async () => {
    const token = await readToken();
    if (!token) {
      setStatus('signed-out');
      return;
    }
    try {
      const res = await api.me();
      setUser(res.user);
      setAccount(res.account);
      setExpired(false);
      setStatus('signed-in');
    } catch (err) {
      // A 401 already ran endSession via the API client. Anything else — no network on a
      // cold start, a 500 — must NOT sign the user out; they may simply be on a train.
      if (err instanceof ApiError && err.status === 401) return;
      setStatus('signed-out');
    }
  }, []);

  React.useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const finishSignIn = React.useCallback(async (token: string) => {
    await writeToken(token);
    const res = await api.me();
    setUser(res.user);
    setAccount(res.account);
    setExpired(false);
    setStatus('signed-in');
  }, []);

  const doLogin = React.useCallback(
    async (input: LoginInput) => {
      // ttlDays: 90 is applied server-side for every API login — see api.auth.login.tsx. The
      // "remember me" switch does not change it; on a personal phone, always remembering is
      // the right default and the toggle only exists to match the web's wording.
      const { token } = await api.login(input);
      await finishSignIn(token);
    },
    [finishSignIn],
  );

  const doRedeem = React.useCallback(
    async (input: RedeemInviteInput) => {
      const { token } = await api.redeemInvite(input);
      await finishSignIn(token);
    },
    [finishSignIn],
  );

  const doLogout = React.useCallback(async () => {
    // BEFORE the session token is discarded: /api/push/unregister is authenticated, and a device
    // left registered keeps receiving notifications for an account nobody is signed into.
    await unregisterToken();
    try {
      await api.logout(); // Ends only this device's session row.
    } catch {
      // Signing out locally must succeed even with no network. The server row expires anyway.
    }
    endSession({ expired: false });
  }, [endSession]);

  const refresh = React.useCallback(async () => {
    try {
      const res = await api.me();
      setUser(res.user);
      setAccount(res.account);
    } catch {
      /* a 401 is handled centrally; anything else leaves the stale name on screen */
    }
  }, []);

  const value = React.useMemo(
    () => ({
      status,
      user,
      account,
      expired,
      login: doLogin,
      redeemInvite: doRedeem,
      logout: doLogout,
      refresh,
    }),
    [status, user, account, expired, doLogin, doRedeem, doLogout, refresh],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthCtxValue {
  const ctx = React.useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** True for Admin staff only — the gate on the Config row in More. */
export function useIsAdmin(): boolean {
  const { user } = useAuth();
  return user?.kind === 'staff' && user.role === 'Admin';
}
