-- Preview-branch trigger for the CF preview workflow (hyperdrive-bench).
-- Intentional no-op: exercises the Supabase GitHub integration's
-- "Supabase changes only" auto-branching without altering any schema.
-- Safe if merged - changes nothing in production.
select 1;
