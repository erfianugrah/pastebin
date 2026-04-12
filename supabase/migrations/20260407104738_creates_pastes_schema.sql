CREATE TABLE pastes (
    id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    content text NOT NULL,
    title text NOT NULL,
    language text,
    created_at timestamptz DEFAULT now(),
    expires_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    visibility text CHECK (visibility IN ('public', 'private')) NOT NULL,
    burn_after_reading boolean NOT NULL DEFAULT false,
    read_count int NOT NULL DEFAULT 0,
    is_encrypted boolean NOT NULL DEFAULT false,
    view_limit int,
    version int NOT NULL DEFAULT 0,
    delete_token uuid NOT NULL DEFAULT gen_random_uuid()
);

CREATE TABLE slugs (
    slug text PRIMARY KEY NOT NULL,
    paste_id uuid REFERENCES pastes(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at
BEFORE UPDATE OF content, title
ON pastes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
