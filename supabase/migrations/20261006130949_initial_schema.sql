-- Production tracker: businesses, their people, products and daily numbers.
--
-- Every row belongs to one business. Row-level security lets people read and
-- write only the businesses they are members of: staff can enter daily
-- numbers, and only owners can change products, groups and staff.

-- --- Tables --------------------------------------------------------------

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.memberships (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Copied at join time so owners can see who their staff are.
  email text not null,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

create table public.invites (
  business_id uuid not null references public.businesses (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and position('@' in email) > 1),
  role text not null default 'staff' check (role in ('owner', 'staff')),
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (business_id, email)
);

create index invites_email_idx on public.invites (email);

create table public.product_groups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, business_id)
);

create index product_groups_business_id_idx on public.product_groups (business_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  group_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 60),
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  -- A product's group must belong to the same business.
  foreign key (group_id, business_id) references public.product_groups (id, business_id) on delete cascade
);

create index products_business_id_idx on public.products (business_id);
create index products_group_id_idx on public.products (group_id, business_id);

create table public.daily_entries (
  business_id uuid not null,
  product_id uuid not null,
  date date not null,
  produced int not null default 0 check (produced between 0 and 99999),
  wasted int not null default 0 check (wasted >= 0 and wasted <= produced),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (product_id, date),
  -- An entry's product must belong to the same business.
  foreign key (product_id, business_id) references public.products (id, business_id) on delete cascade
);

create index daily_entries_business_date_idx on public.daily_entries (business_id, date);

create function public.touch_daily_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger daily_entries_touch
before insert or update on public.daily_entries
for each row execute function public.touch_daily_entry();

-- --- Membership checks ---------------------------------------------------
-- In a schema the API doesn't expose. SECURITY DEFINER so policies on
-- memberships can call them without recursing into their own RLS.

create schema private;
grant usage on schema private to authenticated;

create function private.is_member(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.business_id = bid and m.user_id = (select auth.uid())
  );
$$;

create function private.is_owner(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.business_id = bid and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

revoke all on function private.is_member(uuid), private.is_owner(uuid) from public, anon;
grant execute on function private.is_member(uuid), private.is_owner(uuid) to authenticated;

-- --- Row-level security --------------------------------------------------

alter table public.businesses enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;
alter table public.product_groups enable row level security;
alter table public.products enable row level security;
alter table public.daily_entries enable row level security;

-- Nothing here is public: logged-out visitors get no table access at all.
revoke all on public.businesses, public.memberships, public.invites,
  public.product_groups, public.products, public.daily_entries from anon;

-- Businesses are created through create_business(), never inserted directly.
create policy "Members can see their business" on public.businesses
  for select to authenticated using (private.is_member(id));
create policy "Owners can rename their business" on public.businesses
  for update to authenticated using (private.is_owner(id)) with check (private.is_owner(id));

-- Memberships are created by create_business() and accept_invites().
create policy "Members can see who is in their business" on public.memberships
  for select to authenticated using (private.is_member(business_id));
create policy "Owners can remove other members" on public.memberships
  for delete to authenticated
  using (private.is_owner(business_id) and user_id <> (select auth.uid()));

create policy "Owners can see invites" on public.invites
  for select to authenticated using (private.is_owner(business_id));
create policy "Owners can invite staff" on public.invites
  for insert to authenticated with check (private.is_owner(business_id) and role = 'staff');
create policy "Owners can cancel invites" on public.invites
  for delete to authenticated using (private.is_owner(business_id));

-- Groups and products are hidden (archived), never deleted, so history stays.
create policy "Members can see groups" on public.product_groups
  for select to authenticated using (private.is_member(business_id));
create policy "Owners can add groups" on public.product_groups
  for insert to authenticated with check (private.is_owner(business_id));
create policy "Owners can change groups" on public.product_groups
  for update to authenticated using (private.is_owner(business_id)) with check (private.is_owner(business_id));

create policy "Members can see products" on public.products
  for select to authenticated using (private.is_member(business_id));
create policy "Owners can add products" on public.products
  for insert to authenticated with check (private.is_owner(business_id));
create policy "Owners can change products" on public.products
  for update to authenticated using (private.is_owner(business_id)) with check (private.is_owner(business_id));

create policy "Members can see daily numbers" on public.daily_entries
  for select to authenticated using (private.is_member(business_id));
create policy "Members can enter daily numbers" on public.daily_entries
  for insert to authenticated with check (private.is_member(business_id));
create policy "Members can correct daily numbers" on public.daily_entries
  for update to authenticated using (private.is_member(business_id)) with check (private.is_member(business_id));

-- --- Functions the app calls ---------------------------------------------

-- Creates a business and makes the caller its owner, in one step.
create function public.create_business(business_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  bid uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.businesses (name) values (trim(business_name)) returning id into bid;
  insert into public.memberships (business_id, user_id, email, role)
  values (bid, uid, lower(coalesce(auth.jwt() ->> 'email', '')), 'owner');
  return bid;
end;
$$;

-- Turns any invites for the caller's (verified) email into memberships.
-- Called after every login; returns how many businesses were joined.
create function public.accept_invites()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  mail text := lower(auth.jwt() ->> 'email');
  joined int;
begin
  if uid is null or mail is null or mail = '' then
    return 0;
  end if;

  insert into public.memberships (business_id, user_id, email, role)
  select i.business_id, uid, mail, i.role from public.invites i where i.email = mail
  on conflict (business_id, user_id) do nothing;
  get diagnostics joined = row_count;

  delete from public.invites where email = mail;
  return joined;
end;
$$;

revoke all on function public.create_business(text), public.accept_invites() from public, anon;
grant execute on function public.create_business(text), public.accept_invites() to authenticated;
