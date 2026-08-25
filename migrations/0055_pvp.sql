-- PvP vocabulary battles (F33/F34). One row per finished match, one child row per player.
-- pvp_match_players carries no tenant_id: rows are fenced by their match.
CREATE TABLE pvp_matches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  topic_id TEXT NOT NULL REFERENCES flashcard_topics(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  played_at TEXT NOT NULL
);
CREATE INDEX idx_pvp_matches_tenant_played ON pvp_matches(tenant_id, played_at);

CREATE TABLE pvp_match_players (
  match_id TEXT NOT NULL REFERENCES pvp_matches(id) ON DELETE CASCADE,
  student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
  staff_id TEXT REFERENCES staff(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  score INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (match_id, rank)
);
CREATE INDEX idx_pvp_match_players_student ON pvp_match_players(student_id);
