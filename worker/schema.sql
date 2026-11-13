CREATE TABLE submissions (
  id INTEGER PRIMARY KEY,
  puzzle_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  d1 REAL NOT NULL,
  d2 REAL NOT NULL,
  d3 REAL NOT NULL,
  d4 REAL NOT NULL,
  d5 REAL NOT NULL,
  d6 REAL NOT NULL,
  d7 REAL NOT NULL,
  half_width REAL NOT NULL,
  ms_to_lock INTEGER NOT NULL,
  sample_key INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (puzzle_id, client_id)
);
CREATE INDEX submissions_sample ON submissions (puzzle_id, sample_key);
CREATE TABLE puzzle_counts (puzzle_id TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE stats_cache (puzzle_id TEXT PRIMARY KEY, body TEXT NOT NULL, computed_at TEXT NOT NULL);
