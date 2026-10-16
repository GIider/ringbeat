-- Leaderboards: the server re-plays each run's input log and ranks only what it computed itself. See docs/CLOUD.md.

-- verified: 0 = not checked (no replay, older RULES, or waiting for the cron), 1 = re-played, the stored numbers are
-- the server's; -1 = invalid (unknown song, garbled log, failed or demo run). rules: the RULES the run was played
-- under. loadout: the mods as played (JSON), rtttl: a custom song's melody; both needed to re-play it later.
-- flags: what looked automated (moderation only, never enforced). hidden: removed from boards by moderation.
ALTER TABLE runs ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN rules TEXT;
ALTER TABLE runs ADD COLUMN loadout TEXT;
ALTER TABLE runs ADD COLUMN rtttl TEXT;
ALTER TABLE runs ADD COLUMN flags TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

-- Accuracy was clamped to 0..1 although runs send percent: every older row says 1. Unknown now, so 0 until re-played.
UPDATE runs SET accuracy = 0;

-- public: shown on leaderboards (the player can opt out). hidden: banned from leaderboards by moderation.
ALTER TABLE users ADD COLUMN public INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

CREATE INDEX runs_rank ON runs(song_id, diff, rules, score DESC) WHERE verified = 1 AND hidden = 0;
CREATE INDEX runs_pending ON runs(verified, rules) WHERE verified = 0 AND replay IS NOT NULL;
