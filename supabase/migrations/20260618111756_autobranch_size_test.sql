-- no-op migration to trigger Supabase auto-branching (compute-size test)
DO $$ BEGIN RAISE NOTICE 'auto-branching size test'; END $$;
