-- Pull-based email verification (server/services/email.ts, app/routes/verify-email.tsx). A
-- verified email is what lets Google sign-in match an account by address rather than only by
-- `google_sub` — see server/services/google-auth.ts.
CREATE TABLE email_verifications (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The address being proven, snapshotted at send time — accounts.email_verified_at is cleared
  -- whenever accounts.email changes, but a token minted just before that change must still prove
  -- the address it was actually sent to, not whatever the row says by the time it's clicked.
  email      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);
