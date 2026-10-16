-- Ringbeat API: online profiles, cloud save, run history. See docs/CLOUD.md.

-- A player. Logins (identities) point at it, so more sign-in providers can join the same profile later.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created INTEGER NOT NULL
);

-- One row per login: ('github', '<numeric GitHub user id>'). Nothing else from the provider is stored.
CREATE TABLE identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities(user_id);

-- Bearer tokens, stored as SHA-256 hex.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Short-lived sign-in state: the OAuth state parameter, and the one-time code handed back to the game.
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  return_to TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE login_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);

-- The document every device edits (settings, favourites, my songs); rev guards against lost updates.
CREATE TABLE shared_docs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  doc TEXT NOT NULL,
  rev INTEGER NOT NULL,
  updated INTEGER NOT NULL
);

-- Each device's own scores and stats; only that device writes its row.
CREATE TABLE device_slots (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  doc TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
);

-- Every finished run: the source for online leaderboards. `replay` is reserved for server-side score checks.
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_run_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  diff TEXT NOT NULL,
  score INTEGER NOT NULL,
  grade TEXT NOT NULL,
  accuracy REAL NOT NULL,
  max_combo INTEGER NOT NULL,
  fc INTEGER NOT NULL,
  ap INTEGER NOT NULL,
  mods TEXT NOT NULL,
  mult REAL NOT NULL,
  game_version TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  replay TEXT,
  UNIQUE (user_id, client_run_id)
);
CREATE INDEX runs_board ON runs(song_id, diff, score DESC);
CREATE INDEX runs_user ON runs(user_id, played_at);
