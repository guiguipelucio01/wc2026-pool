-- Schedule the fetch-results Edge Function every 2 minutes via pg_cron + pg_net.
-- Requirements: pg_cron and pg_net extensions must be enabled in your Supabase project.
--   Dashboard → Database → Extensions → search "pg_cron" and "pg_net" → enable both.
--
-- Run this once in the Supabase SQL editor.

select cron.schedule(
  'wc2026-fetch-results',                           -- job name
  '*/2 * * * *',                                    -- every 2 minutes
  $$
  select
    net.http_post(
      url     := 'https://wyfomomcjevtjwqffbix.supabase.co/functions/v1/fetch-results',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer sb_publishable_rBtDmIo-1BlQDhncJpQefw_c5beVSjR"}'::jsonb,
      body    := '{}'::jsonb
    ) as request_id;
  $$
);
