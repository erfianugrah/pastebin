-- Fix: set_updated_at trigger was firing on every save (including read_count
-- increments) because SupabasePasteRepository uses upsert() which sends all
-- columns. UPDATE OF content, title fires when those columns are listed in the
-- SET clause, regardless of whether the values actually changed.
--
-- Add a WHEN clause that compares OLD vs NEW so the trigger only fires when
-- content or title actually changed.
--
-- Observed before fix:
--   - Pastes with read_count = 0: updated_at - created_at ≈ 100-200ms (insert latency only)
--   - Pastes with read_count > 0: updated_at - created_at grows ~500-600ms per view
--
-- Postgres semantics: WHEN clause uses IS DISTINCT FROM (not =) to handle NULL
-- correctly. content and title are NOT NULL so = would also work, but IS DISTINCT
-- FROM is the safer idiom for trigger WHEN clauses.

DROP TRIGGER IF EXISTS set_updated_at ON pastes;

CREATE TRIGGER set_updated_at
BEFORE UPDATE OF content, title
ON pastes
FOR EACH ROW
WHEN (
  OLD.content IS DISTINCT FROM NEW.content
  OR OLD.title IS DISTINCT FROM NEW.title
)
EXECUTE FUNCTION set_updated_at();
