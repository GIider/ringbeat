-- One difficulty: the diff column goes, and the ranking index with it (SQLite cannot drop an indexed column).
-- Runs of the old rules are outdated anyway (RULES 3), so nothing is merged or moved.
-- Clients that still send `diff` are fine: the API ignores it.
DROP INDEX IF EXISTS runs_rank;
ALTER TABLE runs DROP COLUMN diff;
CREATE INDEX runs_rank ON runs(song_id, rules, score DESC) WHERE verified = 1 AND hidden = 0;
