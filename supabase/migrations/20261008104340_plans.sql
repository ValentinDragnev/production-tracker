-- Plans instead of all-or-nothing access.
--
--   free       up to 5 products, 1 staff, no stock, last 7 days of numbers
--   standard   up to 15 products, 2 staff, stock, full history
--   unlimited  no limits
--
-- The 30-day trial is Unlimited. When it (or a paid period) ends, the
-- business falls back to Free instead of being locked. Only the admin's
-- manual lock stops everything. Over the limit after a downgrade, the first
-- products in Settings order (and the earliest staff) keep working; nothing
-- is deleted, and everything comes back with an upgrade.

-- --- Which plan applies now ----------------------------------------------

-- The paid plan for the period up to paid_until; null for trial or free.
alter table public.subscriptions
  add column tier text check (tier in ('standard', 'unlimited'));
alter table public.payments
  add column tier text check (tier in ('standard', 'unlimited'));

create function private.current_tier(bid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when s.locked then 'locked'
    when s.trial_ends_at > now() then 'unlimited'
    when s.paid_until > now() and s.tier is not null then s.tier
    else 'free'
  end
  from public.subscriptions s
  where s.business_id = bid;
$$;

-- Null means no limit.
create function private.product_limit(bid uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case private.current_tier(bid) when 'free' then 5 when 'standard' then 15 when 'locked' then 0 end;
$$;

create function private.staff_limit(bid uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case private.current_tier(bid) when 'free' then 1 when 'standard' then 2 when 'locked' then 0 end;
$$;

-- Stock (Склад) and history older than 7 days.
create function private.has_paid_features(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_tier(bid) in ('standard', 'unlimited');
$$;

create function private.sofia_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Sofia')::date;
$$;

-- Free plans see and edit only the last 7 days (today and the 6 before).
create function private.in_history_window(bid uuid, d date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_paid_features(bid) or d >= private.sofia_today() - 6;
$$;

-- May the caller enter numbers? Not when locked; staff only while they fit
-- the plan (earliest added first).
create function private.can_enter(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_tier(bid) <> 'locked' and (
    private.is_owner(bid)
    or private.staff_limit(bid) is null
    or coalesce((
      select r.rank <= private.staff_limit(bid)
      from (
        select m.user_id, row_number() over (order by m.created_at, m.user_id) as rank
        from public.memberships m
        where m.business_id = bid and m.role = 'staff'
      ) r
      where r.user_id = (select auth.uid())
    ), false)
  );
$$;

-- Is this product among the ones the plan covers? The first N visible
-- products in Settings order (group order, then product order).
create function private.product_in_plan(pid uuid, bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.product_limit(bid) is null or pid in (
    select p.id
    from public.products p
    join public.product_groups g on g.id = p.group_id
    where p.business_id = bid and not p.archived and not g.archived
    order by g.sort_order, g.id, p.sort_order, p.id
    limit private.product_limit(bid)
  );
$$;

-- "Active" now means "not locked": the free plan never runs out.
create or replace function private.is_active(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_tier(bid) <> 'locked';
$$;

revoke all on function
  private.current_tier(uuid), private.product_limit(uuid), private.staff_limit(uuid),
  private.has_paid_features(uuid), private.in_history_window(uuid, date), private.can_enter(uuid),
  private.product_in_plan(uuid, uuid)
from public, anon;
grant execute on function
  private.current_tier(uuid), private.product_limit(uuid), private.staff_limit(uuid),
  private.has_paid_features(uuid), private.in_history_window(uuid, date), private.can_enter(uuid),
  private.product_in_plan(uuid, uuid), private.sofia_today()
to authenticated;

-- --- Daily numbers -------------------------------------------------------

drop policy "Members can see daily numbers" on public.daily_entries;
drop policy "Members can enter daily numbers" on public.daily_entries;
drop policy "Members can correct daily numbers" on public.daily_entries;

create policy "Members can see daily numbers" on public.daily_entries
  for select to authenticated
  using (private.is_member(business_id) and private.in_history_window(business_id, date));
create policy "Members can enter daily numbers" on public.daily_entries
  for insert to authenticated
  with check (
    private.is_member(business_id) and private.can_enter(business_id)
    and private.product_in_plan(product_id, business_id) and private.in_history_window(business_id, date)
  );
create policy "Members can correct daily numbers" on public.daily_entries
  for update to authenticated
  using (
    private.is_member(business_id) and private.can_enter(business_id)
    and private.product_in_plan(product_id, business_id) and private.in_history_window(business_id, date)
  )
  with check (
    private.is_member(business_id) and private.can_enter(business_id)
    and private.product_in_plan(product_id, business_id) and private.in_history_window(business_id, date)
  );

-- --- Stock is a paid feature ---------------------------------------------

drop policy "Owners can add supplies" on public.supplies;
drop policy "Owners can change supplies" on public.supplies;
create policy "Owners can add supplies" on public.supplies
  for insert to authenticated
  with check (private.is_owner(business_id) and private.has_paid_features(business_id));
create policy "Owners can change supplies" on public.supplies
  for update to authenticated
  using (private.is_owner(business_id) and private.has_paid_features(business_id))
  with check (private.is_owner(business_id) and private.has_paid_features(business_id));

drop policy "Members can record supplies" on public.supply_days;
drop policy "Members can correct supplies" on public.supply_days;
create policy "Members can record supplies" on public.supply_days
  for insert to authenticated
  with check (private.is_member(business_id) and private.can_enter(business_id) and private.has_paid_features(business_id));
create policy "Members can correct supplies" on public.supply_days
  for update to authenticated
  using (private.is_member(business_id) and private.can_enter(business_id) and private.has_paid_features(business_id))
  with check (private.is_member(business_id) and private.can_enter(business_id) and private.has_paid_features(business_id));

-- --- Product and staff limits --------------------------------------------

-- Adding a product, or un-hiding one, must fit the plan. Edits to products
-- that are already active (rename, reorder) always go through, also when a
-- downgrade left the business over its limit.
create function private.check_product_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lim int := private.product_limit(new.business_id);
begin
  if new.archived or lim is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and not old.archived then
    return new;
  end if;
  -- An upsert of an existing active product fires this as an INSERT first.
  if tg_op = 'INSERT' and exists (select 1 from public.products p where p.id = new.id and not p.archived) then
    return new;
  end if;
  if (select count(*) from public.products p
      where p.business_id = new.business_id and not p.archived and p.id <> new.id) >= lim then
    raise exception 'product_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger products_check_limit
before insert or update of archived on public.products
for each row execute function private.check_product_limit();

-- Invites: the email rules from before, plus the plan's staff limit
-- (current staff + other pending invites).
create or replace function private.check_invite_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lim int := private.staff_limit(new.business_id);
begin
  if exists (
    select 1
    from public.memberships m
    left join auth.users u on u.id = m.user_id
    where m.email = new.email or lower(u.email) = new.email
  ) or exists (
    select 1 from public.invites i
    where i.email = new.email and i.business_id <> new.business_id
  ) then
    raise exception 'email_in_use' using errcode = 'P0001';
  end if;
  if lim is not null and (
    (select count(*) from public.memberships m where m.business_id = new.business_id and m.role = 'staff')
    + (select count(*) from public.invites i where i.business_id = new.business_id and i.email <> new.email)
  ) >= lim then
    raise exception 'staff_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- --- Prices per plan -----------------------------------------------------

alter table public.app_settings
  drop column monthly_price,
  drop column yearly_price,
  add column standard_monthly numeric(10, 2) default 10,
  add column standard_yearly numeric(10, 2),
  add column unlimited_monthly numeric(10, 2) default 20,
  add column unlimited_yearly numeric(10, 2);

update public.app_settings set standard_monthly = 10, unlimited_monthly = 20;

drop function public.admin_save_settings(numeric, numeric, text, text, text, text);

create function public.admin_save_settings(
  standard_monthly numeric,
  standard_yearly numeric,
  unlimited_monthly numeric,
  unlimited_yearly numeric,
  payment_info_bg text,
  payment_info_en text,
  revolut_link text,
  contact_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.app_settings
  set standard_monthly = admin_save_settings.standard_monthly,
      standard_yearly = admin_save_settings.standard_yearly,
      unlimited_monthly = admin_save_settings.unlimited_monthly,
      unlimited_yearly = admin_save_settings.unlimited_yearly,
      payment_info_bg = coalesce(admin_save_settings.payment_info_bg, ''),
      payment_info_en = coalesce(admin_save_settings.payment_info_en, ''),
      revolut_link = trim(coalesce(admin_save_settings.revolut_link, '')),
      contact_email = lower(trim(coalesce(admin_save_settings.contact_email, ''))),
      updated_at = now()
  where id;
end;
$$;

-- --- Admin: payments now buy a plan --------------------------------------

drop function public.admin_record_payment(uuid, numeric, int, text, date, text);

create function public.admin_record_payment(
  bid uuid,
  tier text,
  amount numeric,
  months int,
  method text,
  paid_on date default current_date,
  note text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.subscriptions;
  starts timestamptz;
  ends timestamptz;
begin
  perform private.require_admin();
  if tier not in ('standard', 'unlimited') then
    raise exception 'bad_tier' using errcode = 'P0001';
  end if;
  select * into s from public.subscriptions where business_id = bid for update;
  if not found then
    raise exception 'no_such_business' using errcode = 'P0001';
  end if;

  starts := greatest(now(), s.trial_ends_at, coalesce(s.paid_until, '-infinity'::timestamptz));
  ends := starts + make_interval(months => months);

  insert into public.payments (business_id, tier, amount, months, method, paid_on, note, covers_from, covers_until)
  values (bid, tier, amount, months, method, coalesce(paid_on, current_date), nullif(trim(note), ''), starts, ends);

  update public.subscriptions
  set paid_until = ends,
      tier = admin_record_payment.tier,
      plan = case when months >= 12 then 'yearly' else 'monthly' end,
      updated_at = now()
  where business_id = bid;
  return ends;
end;
$$;

-- Deleting a payment also restores the plan of the latest remaining one.
create or replace function public.admin_delete_payment(payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  bid uuid;
  latest public.payments;
begin
  perform private.require_admin();
  delete from public.payments where id = payment_id returning business_id into bid;
  if bid is null then
    return;
  end if;
  select * into latest from public.payments where business_id = bid order by covers_until desc limit 1;
  update public.subscriptions
  set paid_until = latest.covers_until,
      tier = latest.tier,
      updated_at = now()
  where business_id = bid;
end;
$$;

drop function public.admin_customers();

create function public.admin_customers()
returns table (
  business_id uuid,
  business_name text,
  created_at timestamptz,
  owner_email text,
  staff_count int,
  trial_ends_at timestamptz,
  paid_until timestamptz,
  plan text,
  tier text,
  locked boolean,
  products_count int,
  last_entry_at timestamptz,
  days_entered_last_7 int,
  total_paid numeric,
  phone text,
  notes text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select
    b.id,
    b.name,
    b.created_at,
    (select string_agg(m.email, ', ') from public.memberships m where m.business_id = b.id and m.role = 'owner'),
    (select count(*)::int from public.memberships m where m.business_id = b.id and m.role = 'staff'),
    s.trial_ends_at,
    s.paid_until,
    s.plan,
    s.tier,
    s.locked,
    (select count(*)::int from public.products p where p.business_id = b.id and not p.archived),
    (select max(e.updated_at) from public.daily_entries e where e.business_id = b.id),
    (select count(distinct e.date)::int from public.daily_entries e
      where e.business_id = b.id and e.date > current_date - 7),
    coalesce((select sum(p.amount) from public.payments p where p.business_id = b.id), 0),
    n.phone,
    n.notes
  from public.businesses b
  join public.subscriptions s on s.business_id = b.id
  left join public.customer_notes n on n.business_id = b.id
  order by b.created_at desc;
end;
$$;

revoke all on function
  public.admin_save_settings(numeric, numeric, numeric, numeric, text, text, text, text),
  public.admin_record_payment(uuid, text, numeric, int, text, date, text),
  public.admin_customers()
from public, anon;
grant execute on function
  public.admin_save_settings(numeric, numeric, numeric, numeric, text, text, text, text),
  public.admin_record_payment(uuid, text, numeric, int, text, date, text),
  public.admin_customers()
to authenticated;

-- --- Reminders know the plan that is ending ------------------------------

drop function public.claim_due_reminders();

create function public.claim_due_reminders()
returns table (
  log_id uuid,
  business_id uuid,
  business_name text,
  owner_emails text[],
  kind text,
  period_end timestamptz,
  is_trial boolean,
  tier text
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
      (s.paid_until is null or s.paid_until <= s.trial_ends_at) as trial,
      s.tier as paid_tier
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
    d.trial,
    d.paid_tier
  from claimed c
  join due d on d.bid = c.business_id;
end;
$$;

revoke all on function public.claim_due_reminders() from public, anon, authenticated;
grant execute on function public.claim_due_reminders() to service_role;
