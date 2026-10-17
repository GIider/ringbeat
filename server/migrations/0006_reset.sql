-- The newest "Reset scores & stats" (client clock, ms) the player made while signed in. It deletes their stored runs
-- played up to then and keeps older runs from being stored again. See docs/CLOUD.md.
ALTER TABLE users ADD COLUMN reset_at INTEGER NOT NULL DEFAULT 0;
