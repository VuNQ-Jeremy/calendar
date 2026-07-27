-- Record which build a feedback report came from.
-- Nullable so existing rows, and any caller that omits it, stay valid.
-- Format: "v0.0042 · a1b2c3d" (web) or "v0.0042 · rt1 · a1b2c3d · <updateId>" (mobile).
ALTER TABLE feedback ADD COLUMN app_version TEXT;
