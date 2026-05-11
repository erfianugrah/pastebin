-- Full-text search on paste titles.
--
-- Adds a generated tsvector column populated from title + language, and a
-- GIN index for fast lookups. Search is exposed via the supabase-js
-- .textSearch() filter (translates to `@@ websearch_to_tsquery(...)`).
--
-- Why not search content?
--   - Most pastes are code or encrypted blobs. FTS tokenises English words;
--     `function foo(bar)` becomes useful tokens, but `abcdefgh==` (base64
--     ciphertext) becomes one giant token that matches nothing. Indexing
--     content would bloat the GIN index without improving discovery.
--   - For real code search you'd want pg_trgm + GIN trigram indexes, which
--     is a different feature.
--
-- `to_tsvector('english', ...)` uses the English snowball stemmer:
--   'running' -> 'run', 'tests' -> 'test', stopwords removed.
-- Match this with `websearch_to_tsquery('english', ...)` on the query side
-- so stemming aligns. websearch_to_tsquery handles user input safely:
--   'foo bar'        -> foo & bar
--   '"foo bar"'      -> foo <-> bar  (phrase)
--   'foo OR bar'     -> foo | bar
--   '-bar'           -> ! bar        (exclude)
-- Bad input degrades gracefully -- no parser errors thrown to the user.

ALTER TABLE public.pastes
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(language, '')
    )
  ) STORED;

-- GIN is the right index type for tsvector. Larger than BTREE but much
-- faster for set-membership queries (`@@`).
CREATE INDEX idx_pastes_search ON public.pastes USING GIN (search_vector);
