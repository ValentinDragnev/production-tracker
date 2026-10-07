-- Subscriptions: every business gets a 30-day free trial, then pays monthly
-- or yearly. When neither the trial nor a paid period covers today (or the
-- admin locked it), the business can still read everything but can't enter
-- new numbers. The app's owner manages customers through admin_* functions.

-- --- Platform admins -----------------------------------------------------
-- Matched by verified login email, so an admin works before or after their
-- first login. Only reachable through the functions below.

create table public.platform_admins (
  email text primary key check (email = lower(trim(email)))
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

insert into public.platform_admins (email) values ('valentindragnev101@gmail.com');

create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins a
    where a.email = lower((select auth.jwt()) ->> 'email')
  );
$$;

revoke all on function private.is_platform_admin() from public, anon;
grant execute on function private.is_platform_admin() to authenticated;

-- Lets the app decide whether to show the admin panel.
create function public.am_i_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin();
$$;

-- --- Subscriptions -------------------------------------------------------

create table public.subscriptions (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  trial_ends_at timestamptz not null default now() + interval '30 days',
  paid_until timestamptz,
  plan text check (plan in ('monthly', 'yearly')),
  -- Admin's manual lock, regardless of dates (e.g. a bounced payment).
  locked boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Existing businesses start their 30 days now.
insert into public.subscriptions (business_id) select id from public.businesses;

create function private.start_trial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscriptions (business_id) values (new.id);
  return new;
end;
$$;

create trigger businesses_start_trial
after insert on public.businesses
for each row execute function private.start_trial();

create function private.is_active(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.business_id = bid
      and not s.locked
      and now() < greatest(s.trial_ends_at, coalesce(s.paid_until, '-infinity'::timestamptz))
  );
$$;

revoke all on function private.is_active(uuid) from public, anon;
grant execute on function private.is_active(uuid) to authenticated;

alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon;
create policy "Members can see their subscription" on public.subscriptions
  for select to authenticated using (private.is_member(business_id));

-- Entering numbers needs an active subscription; reading never does.
drop policy "Members can enter daily numbers" on public.daily_entries;
drop policy "Members can correct daily numbers" on public.daily_entries;
create policy "Members can enter daily numbers" on public.daily_entries
  for insert to authenticated
  with check (private.is_member(business_id) and private.is_active(business_id));
create policy "Members can correct daily numbers" on public.daily_entries
  for update to authenticated
  using (private.is_member(business_id) and private.is_active(business_id))
  with check (private.is_member(business_id) and private.is_active(business_id));

-- --- Payments and admin notes (admin only) -------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  amount numeric(10, 2) not null check (amount >= 0),
  currency text not null default 'EUR',
  paid_on date not null default current_date,
  months int not null check (months between 1 and 36),
  method text not null check (method in ('bank', 'card', 'cash', 'other')),
  note text,
  covers_from timestamptz not null,
  covers_until timestamptz not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index payments_business_id_idx on public.payments (business_id, covers_until);

create table public.customer_notes (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  phone text,
  notes text,
  updated_at timestamptz not null default now()
);

-- No policies: only the admin functions below (SECURITY DEFINER) touch these.
alter table public.payments enable row level security;
alter table public.customer_notes enable row level security;
revoke all on public.payments, public.customer_notes from anon, authenticated;

-- --- Prices and how to pay (one row) -------------------------------------

create table public.app_settings (
  id boolean primary key default true check (id),
  monthly_price numeric(10, 2),
  yearly_price numeric(10, 2),
  currency text not null default 'EUR',
  -- Shown to locked businesses: bank details, phone, what to write as reason.
  payment_info_bg text not null default '',
  payment_info_en text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.app_settings default values;

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon;
create policy "Everyone logged in can read prices" on public.app_settings
  for select to authenticated using (true);

-- --- Admin functions -----------------------------------------------------

create function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
end;
$$;

-- One row per business with everything the admin overview needs.
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

create function public.admin_payments(bid uuid)
returns setof public.payments
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query select * from public.payments p where p.business_id = bid order by p.covers_until desc;
end;
$$;

-- Records a payment and extends access. A new period starts when the current
-- one (trial or paid) ends, or today if that's already past.
create function public.admin_record_payment(
  bid uuid,
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
  select * into s from public.subscriptions where business_id = bid for update;
  if not found then
    raise exception 'no_such_business' using errcode = 'P0001';
  end if;

  starts := greatest(now(), s.trial_ends_at, coalesce(s.paid_until, '-infinity'::timestamptz));
  ends := starts + make_interval(months => months);

  insert into public.payments (business_id, amount, months, method, paid_on, note, covers_from, covers_until)
  values (bid, amount, months, method, coalesce(paid_on, current_date), nullif(trim(note), ''), starts, ends);

  update public.subscriptions
  set paid_until = ends,
      plan = case when months >= 12 then 'yearly' else 'monthly' end,
      updated_at = now()
  where business_id = bid;
  return ends;
end;
$$;

-- Removes a payment recorded by mistake; access then runs to the end of the
-- latest remaining payment.
create function public.admin_delete_payment(payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  bid uuid;
begin
  perform private.require_admin();
  delete from public.payments where id = payment_id returning business_id into bid;
  if bid is null then
    return;
  end if;
  update public.subscriptions
  set paid_until = (select max(covers_until) from public.payments where business_id = bid),
      updated_at = now()
  where business_id = bid;
end;
$$;

create function public.admin_set_trial_end(bid uuid, ends_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.subscriptions set trial_ends_at = ends_at, updated_at = now() where business_id = bid;
end;
$$;

create function public.admin_set_locked(bid uuid, is_locked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.subscriptions set locked = is_locked, updated_at = now() where business_id = bid;
end;
$$;

create function public.admin_save_notes(bid uuid, phone text, notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  insert into public.customer_notes (business_id, phone, notes)
  values (bid, nullif(trim(phone), ''), nullif(trim(notes), ''))
  on conflict (business_id) do update
    set phone = excluded.phone, notes = excluded.notes, updated_at = now();
end;
$$;

create function public.admin_save_settings(
  monthly_price numeric,
  yearly_price numeric,
  payment_info_bg text,
  payment_info_en text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.app_settings
  set monthly_price = admin_save_settings.monthly_price,
      yearly_price = admin_save_settings.yearly_price,
      payment_info_bg = coalesce(admin_save_settings.payment_info_bg, ''),
      payment_info_en = coalesce(admin_save_settings.payment_info_en, ''),
      updated_at = now()
  where id;
end;
$$;

revoke all on function
  private.require_admin(),
  public.am_i_admin(),
  public.admin_customers(),
  public.admin_payments(uuid),
  public.admin_record_payment(uuid, numeric, int, text, date, text),
  public.admin_delete_payment(uuid),
  public.admin_set_trial_end(uuid, timestamptz),
  public.admin_set_locked(uuid, boolean),
  public.admin_save_notes(uuid, text, text),
  public.admin_save_settings(numeric, numeric, text, text)
from public, anon;

grant execute on function
  private.require_admin(),
  public.am_i_admin(),
  public.admin_customers(),
  public.admin_payments(uuid),
  public.admin_record_payment(uuid, numeric, int, text, date, text),
  public.admin_delete_payment(uuid),
  public.admin_set_trial_end(uuid, timestamptz),
  public.admin_set_locked(uuid, boolean),
  public.admin_save_notes(uuid, text, text),
  public.admin_save_settings(numeric, numeric, text, text)
to authenticated;
