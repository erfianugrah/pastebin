-- Exclude encrypted pastes from the public full-text search index.
--
-- Privacy hardening (paired with version-3 title encryption client-side):
--   * For version-3 pastes the `title` column holds CIPHERTEXT (the E2E
--     encrypted title), which is meaningless to index and must never be
--     surfaced via search.
--   * For ALL encrypted pastes (is_encrypted = true, i.e. version >= 2) the
--     plaintext title/language should no longer be world-searchable — an
--     encrypted paste's metadata must not leak through the public search
--     endpoint. This also retroactively removes legacy version-2 pastes'
--     plaintext titles from the search index.
--
-- Dropping the generated column also drops its dependent GIN index, so we
-- recreate the index afterwards. No new table/function is created, so no
-- additional service_role GRANT is required (the column rides on the
-- existing public.pastes grants).

ALTER TABLE public.pastes DROP COLUMN IF EXISTS search_vector;

ALTER TABLE public.pastes
	ADD COLUMN search_vector tsvector
	GENERATED ALWAYS AS (
		to_tsvector(
			'english',
			CASE
				WHEN is_encrypted THEN ''
				ELSE coalesce(title, '') || ' ' || coalesce(language, '')
			END
		)
	) STORED;

CREATE INDEX idx_pastes_search ON public.pastes USING GIN (search_vector);
