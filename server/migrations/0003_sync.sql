-- One snapshot of every song's top runs for GET /boards (the difficulty picker's world top 3), so browsing songs costs
-- one row read instead of a leaderboard query per song. The cron rebuilds it when `dirty` (a run ranked, a name,
-- an opt-out or a hide changed). See docs/CLOUD.md › Requests.
CREATE TABLE board_tops (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rules TEXT NOT NULL DEFAULT '',
  doc TEXT NOT NULL DEFAULT '{}',
  built INTEGER NOT NULL DEFAULT 0,
  dirty INTEGER NOT NULL DEFAULT 1
);
INSERT INTO board_tops (id) VALUES (1);
