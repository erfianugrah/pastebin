CREATE INDEX idx_pastes_visibility_created ON pastes
(visibility, created_at DESC)
WHERE visibility = 'public';

CREATE INDEX idx_pastes_expired_cleanup ON pastes
(expires_at);

CREATE INDEX idx_user_pastes ON pastes
(user_id)
WHERE user_id IS NOT null;
