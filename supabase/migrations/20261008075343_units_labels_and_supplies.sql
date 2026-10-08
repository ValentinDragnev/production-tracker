-- Units for products, the business's wording for the two daily numbers,
-- and supplies (flour, sugar, ...) with deliveries, daily use and stock.

-- --- Units ---------------------------------------------------------------
-- pcs, bag and box are whole numbers; kg and l allow decimals (the app
-- enforces the whole-number part, the database allows 2 decimals for all).

alter table public.products
  add column unit text not null default 'pcs' check (unit in ('pcs', 'kg', 'bag', 'box', 'l'));

alter table public.daily_entries
  alter column produced type numeric(10, 2),
  alter column wasted type numeric(10, 2);

-- --- Wording -------------------------------------------------------------
-- made_thrown: Произведено / Изхвърлено (bakery selling itself)
-- sent_returned: Изпратено / Върнато (workshop delivering to shops)

alter table public.businesses
  add column entry_labels text not null default 'made_thrown' check (entry_labels in ('made_thrown', 'sent_returned'));

-- --- Supplies ------------------------------------------------------------

create table public.supplies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  unit text not null default 'kg' check (unit in ('pcs', 'kg', 'bag', 'box', 'l')),
  -- Warn when stock is at or below this. Null: no warning.
  low_stock_at numeric(10, 2) check (low_stock_at >= 0),
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, business_id)
);

create index supplies_business_id_idx on public.supplies (business_id);

-- One row per supply per day: what came in, what was used, and optionally
-- what was actually on the shelf at the end of that day (a stock count).
create table public.supply_days (
  business_id uuid not null,
  supply_id uuid not null,
  date date not null,
  received numeric(10, 2) not null default 0 check (received between 0 and 99999),
  used numeric(10, 2) not null default 0 check (used between 0 and 99999),
  counted numeric(10, 2) check (counted between 0 and 99999),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (supply_id, date),
  foreign key (supply_id, business_id) references public.supplies (id, business_id) on delete cascade
);

create index supply_days_business_date_idx on public.supply_days (business_id, date);

create trigger supply_days_touch
before insert or update on public.supply_days
for each row execute function public.touch_daily_entry();

alter table public.supplies enable row level security;
alter table public.supply_days enable row level security;
revoke all on public.supplies, public.supply_days from anon;

create policy "Members can see supplies" on public.supplies
  for select to authenticated using (private.is_member(business_id));
create policy "Owners can add supplies" on public.supplies
  for insert to authenticated with check (private.is_owner(business_id));
create policy "Owners can change supplies" on public.supplies
  for update to authenticated using (private.is_owner(business_id)) with check (private.is_owner(business_id));
create policy "Owners can delete supplies" on public.supplies
  for delete to authenticated using (private.is_owner(business_id));

-- Same rule as the product numbers: everyone in the business can record,
-- as long as the subscription is active.
create policy "Members can see supply days" on public.supply_days
  for select to authenticated using (private.is_member(business_id));
create policy "Members can record supplies" on public.supply_days
  for insert to authenticated
  with check (private.is_member(business_id) and private.is_active(business_id));
create policy "Members can correct supplies" on public.supply_days
  for update to authenticated
  using (private.is_member(business_id) and private.is_active(business_id))
  with check (private.is_member(business_id) and private.is_active(business_id));

-- Current stock per supply: the latest count, plus everything received and
-- minus everything used on the days after it. Without a count, it starts
-- from zero. Runs with the caller's rights, so row-level security applies.
create function public.supply_stock(bid uuid)
returns table (supply_id uuid, stock numeric, counted_on date)
language sql
stable
set search_path = ''
as $$
  with last_count as (
    select distinct on (d.supply_id) d.supply_id, d.date, d.counted
    from public.supply_days d
    where d.business_id = bid and d.counted is not null
    order by d.supply_id, d.date desc
  )
  select
    s.id,
    coalesce(lc.counted, 0) + coalesce((
      select sum(d.received - d.used)
      from public.supply_days d
      where d.supply_id = s.id and (lc.date is null or d.date > lc.date)
    ), 0),
    lc.date
  from public.supplies s
  left join last_count lc on lc.supply_id = s.id
  where s.business_id = bid;
$$;

revoke all on function public.supply_stock(uuid) from public, anon;
grant execute on function public.supply_stock(uuid) to authenticated;
