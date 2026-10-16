-- Developer highlight: leaderboard rows of a flagged user carry `dev: true`. Set by hand in D1, never through the API.
ALTER TABLE users ADD COLUMN dev INTEGER NOT NULL DEFAULT 0;
-- The GET /boards snapshot is stale until rebuilt.
UPDATE board_tops SET dirty = 1;
