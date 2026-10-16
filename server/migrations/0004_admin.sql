-- Moderation (docs/CLOUD.md › Moderation). `banned` is the blacklist: the player is hidden from every board, their
-- sessions are dropped, and sign-in and sync answer 403. `admin_log` records every change made through /admin/*.
ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX users_name ON users(display_name);

CREATE TABLE admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
