CREATE POLICY "public pastes are viewable by anyone"
ON pastes
FOR SELECT
TO anon
USING (visibility = 'public');

CREATE POLICY "visible vanity slugs"
ON slugs
FOR SELECT
TO anon
USING (expires_at > now());
