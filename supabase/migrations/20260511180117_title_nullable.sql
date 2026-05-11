-- Bug fix: pastes.title was NOT NULL in the original schema but the API
-- treats it as optional (Paste model has `title?: string`, Zod schema
-- marks it `.optional()`, frontend defaults display to 'Untitled Paste').
-- That mismatch surfaced when Playwright tests POSTed without a title:
-- DB rejected with "null value in column title violates not-null
-- constraint", Worker returned 500.
--
-- Loosen the constraint so the column matches the domain model. No data
-- migration needed (existing rows all have titles).

ALTER TABLE public.pastes ALTER COLUMN title DROP NOT NULL;
