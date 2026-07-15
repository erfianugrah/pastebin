-- Preview-branch trigger for the CF preview workflow (hyperdrive-bench).
-- Intentional no-op: satisfies the Supabase GitHub integration's
-- "Supabase changes only" auto-branching without altering any schema.
-- Uses a DO block (returns NO result set) - a bare `select 1;` produces a
-- result set that the branch migration runner rejects even though psql
-- accepts it. Safe if merged - changes nothing.
do $$ begin perform 1; end $$;
