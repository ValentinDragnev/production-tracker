-- One email belongs to one business, either as its owner or as staff.
-- Owners can also permanently delete groups and products.

-- --- One business per person ---------------------------------------------

alter table public.memberships
  add constraint memberships_one_business_per_user unique (user_id);

-- At most one pending invite per email, across all businesses.
drop index public.invites_email_idx;
alter table public.invites
  add constraint invites_one_per_email unique (email);

-- Refuses invites for emails that already belong to a business, or that
-- another business has already invited. Re-inviting into the same business
-- still hits the unique constraint (23505), which the app treats as done.
create function private.check_invite_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  return new;
end;
$$;

create trigger invites_check_email
before insert on public.invites
for each row execute function private.check_invite_email();

create or replace function public.create_business(business_name text)
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
  if exists (select 1 from public.memberships where user_id = uid) then
    raise exception 'already_in_business' using errcode = 'P0001';
  end if;

  insert into public.businesses (name) values (trim(business_name)) returning id into bid;
  insert into public.memberships (business_id, user_id, email, role)
  values (bid, uid, lower(coalesce(auth.jwt() ->> 'email', '')), 'owner');
  return bid;
end;
$$;

-- Joins the (single) business that invited the caller, unless they already
-- belong to one. Any invite left for their email is cleared either way.
create or replace function public.accept_invites()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  mail text := lower(auth.jwt() ->> 'email');
  joined int := 0;
begin
  if uid is null or mail is null or mail = '' then
    return 0;
  end if;

  if not exists (select 1 from public.memberships where user_id = uid) then
    insert into public.memberships (business_id, user_id, email, role)
    select i.business_id, uid, mail, i.role from public.invites i where i.email = mail
    limit 1
    on conflict do nothing;
    get diagnostics joined = row_count;
  end if;

  delete from public.invites where email = mail;
  return joined;
end;
$$;

-- --- Deleting groups and products ----------------------------------------
-- Deleting a group deletes its products; deleting a product deletes its
-- daily numbers (foreign keys cascade). Hiding stays the safe default.

create policy "Owners can delete groups" on public.product_groups
  for delete to authenticated using (private.is_owner(business_id));

create policy "Owners can delete products" on public.products
  for delete to authenticated using (private.is_owner(business_id));
