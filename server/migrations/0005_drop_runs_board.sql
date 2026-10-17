-- No query uses it: the boards rank through runs_rank (verified, public runs under the current RULES). Dropping it
-- saves an index write on every stored run.
DROP INDEX IF EXISTS runs_board;
