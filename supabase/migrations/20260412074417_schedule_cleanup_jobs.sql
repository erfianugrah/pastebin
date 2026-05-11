SELECT
  cron.schedule(
    'cleanup-expired-pastes', -- job name
    '*/5 * * * *', -- every 5 minutes (standard cron syntax)
    $$ DELETE FROM pastes
    WHERE expires_at < now() $$);

SELECT
  cron.schedule(
    'cleanup-expired-slugs',
    '0 3 * * *',
    $$ DELETE FROM slugs
    WHERE expires_at < now() $$);

