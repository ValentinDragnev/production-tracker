-- Reminder emails before a trial or paid period ends.
-- A daily job calls the send-reminders function, which asks the database
-- which reminders are due (claim_due_reminders) and emails the owners.
-- Each reminder is claimed once per period, so repeated calls send nothing new.

create table public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- week: ends within 7 days, day: within 1 day, ended: ended in the last 3 days
  kind text not null check (kind in ('week', 'day', 'ended')),
  -- The end date the reminder is about; a new period gets new reminders.
  period_end timestamptz not null,
  created_at timestamptz not null default now(),
  unique (business_id, kind, period_end)
);

alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;

-- Returns the reminders that are due now and records them as sent, in one
-- step. Manually locked businesses get no reminders.
create function public.claim_due_reminders()
returns table (
  log_id uuid,
  business_id uuid,
  business_name text,
  owner_emails text[],
  kind text,
  period_end timestamptz,
  is_trial boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with subs as (
    select
      s.business_id as bid,
      b.name,
      greatest(s.trial_ends_at, coalesce(s.paid_until, '-infinity'::timestamptz)) as ends,
      (s.paid_until is null or s.paid_until <= s.trial_ends_at) as trial
    from public.subscriptions s
    join public.businesses b on b.id = s.business_id
    where not s.locked
  ),
  due as (
    select
      subs.*,
      case
        when subs.ends > now() and subs.ends <= now() + interval '1 day' then 'day'
        when subs.ends > now() + interval '1 day' and subs.ends <= now() + interval '7 days' then 'week'
        when subs.ends <= now() and subs.ends > now() - interval '3 days' then 'ended'
      end as due_kind
    from subs
  ),
  claimed as (
    insert into public.reminder_log (business_id, kind, period_end)
    select d.bid, d.due_kind, d.ends from due d where d.due_kind is not null
    on conflict do nothing
    returning reminder_log.id, reminder_log.business_id, reminder_log.kind, reminder_log.period_end
  )
  select
    c.id,
    c.business_id,
    d.name,
    array(
      select m.email from public.memberships m
      where m.business_id = c.business_id and m.role = 'owner' and m.email <> ''
      order by m.created_at
    ),
    c.kind,
    c.period_end,
    d.trial
  from claimed c
  join due d on d.bid = c.business_id;
end;
$$;

-- Un-claims a reminder whose email failed, so tomorrow's run retries it.
create function public.release_reminder(log_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.reminder_log where id = log_id;
$$;

-- Only the server (service role) may run these.
revoke all on function public.claim_due_reminders(), public.release_reminder(uuid) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(), public.release_reminder(uuid) to service_role;

-- Daily at 07:00 UTC (10:00 Sofia in summer, 09:00 in winter). Skipped where
-- pg_cron / pg_net aren't available, e.g. the in-memory test database.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
    perform cron.schedule(
      'send-reminders',
      '0 7 * * *',
      $job$
        select net.http_post(
          url := 'https://qjljcmnwzyldbfbvixfz.supabase.co/functions/v1/send-reminders',
          headers := '{"Content-Type": "application/json"}'::jsonb,
          body := '{}'::jsonb
        );
      $job$
    );
  end if;
end;
$$;
