-- Checks that row-level security keeps businesses apart.
-- Everything runs in one transaction that is rolled back at the end, so the
-- database is left exactly as it was.
--
--   supabase db query --linked -f supabase/tests/rls_check.sql
--
-- Prints "ALL RLS CHECKS PASSED", or stops at the first failing check.

begin;

-- Two throwaway users that only exist inside this transaction.
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000a', 'owner-a@rls-test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000b', 'owner-b@rls-test.invalid', 'authenticated', 'authenticated');

-- Helpers live in a scratch schema that disappears with the rollback.
create schema rls_test;
grant usage on schema rls_test to authenticated, anon;

create function rls_test.act_as(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', case who when 'a' then '00000000-0000-4000-a000-00000000000a' else '00000000-0000-4000-a000-00000000000b' end,
    'email', 'owner-' || who || '@rls-test.invalid',
    'role', 'authenticated')::text, true);
end $$;

-- Fails the whole run with a readable message.
create function rls_test.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'RLS CHECK FAILED: %', label;
  end if;
end $$;

grant execute on all functions in schema rls_test to authenticated, anon;

-- 1. Owner A sets up a business with one product and one day of numbers.
select rls_test.act_as('a');
set local role authenticated;
select set_config('test.biz_a', public.create_business('Bakery A')::text, true);
insert into public.product_groups (id, business_id, name)
  values ('00000000-0000-4000-b000-00000000000a', current_setting('test.biz_a')::uuid, 'Bread');
insert into public.products (id, business_id, group_id, name)
  values ('00000000-0000-4000-c000-00000000000a', current_setting('test.biz_a')::uuid,
          '00000000-0000-4000-b000-00000000000a', 'White bread');
insert into public.daily_entries (business_id, product_id, date, produced, wasted)
  values (current_setting('test.biz_a')::uuid, '00000000-0000-4000-c000-00000000000a', '2026-10-05', 120, 18);
select rls_test.expect((select count(*) = 1 from public.products), 'owner A sees own product');
select rls_test.expect(
  (select updated_by = '00000000-0000-4000-a000-00000000000a' from public.daily_entries),
  'daily entry records who saved it');

-- 2. Owner B, in another business, sees nothing of A and can't write into it.
reset role;
select rls_test.act_as('b');
set local role authenticated;
select set_config('test.biz_b', public.create_business('Bakery B')::text, true);
select rls_test.expect((select count(*) = 1 from public.businesses), 'B sees only own business');
select rls_test.expect((select count(*) = 0 from public.products), 'B cannot see A products');
select rls_test.expect((select count(*) = 0 from public.daily_entries), 'B cannot see A numbers');
select rls_test.expect((select count(*) = 1 from public.memberships), 'B sees only own membership');

do $$
begin
  insert into public.products (business_id, group_id, name)
    values (current_setting('test.biz_a')::uuid, '00000000-0000-4000-b000-00000000000a', 'Sneaky');
  raise exception 'RLS CHECK FAILED: B added a product to A';
exception when insufficient_privilege then null;
end $$;

do $$
begin
  insert into public.daily_entries (business_id, product_id, date, produced, wasted)
    values (current_setting('test.biz_a')::uuid, '00000000-0000-4000-c000-00000000000a', '2026-10-06', 1, 0);
  raise exception 'RLS CHECK FAILED: B entered numbers for A';
exception when insufficient_privilege then null;
end $$;

-- B can't attach its own product to A's group (business mismatch).
insert into public.product_groups (id, business_id, name)
  values ('00000000-0000-4000-b000-00000000000b', current_setting('test.biz_b')::uuid, 'Pastry');
do $$
begin
  insert into public.products (business_id, group_id, name)
    values (current_setting('test.biz_b')::uuid, '00000000-0000-4000-b000-00000000000a', 'Cross-linked');
  raise exception 'RLS CHECK FAILED: product linked to another business''s group';
exception when foreign_key_violation then null;
end $$;

update public.products set name = 'Hacked' where id = '00000000-0000-4000-c000-00000000000a';
delete from public.memberships where business_id = current_setting('test.biz_a')::uuid;

-- 3. A invites B as staff. B joins and can enter numbers but not edit products.
reset role;
select rls_test.act_as('a');
set local role authenticated;
select rls_test.expect(
  (select name = 'White bread' from public.products where id = '00000000-0000-4000-c000-00000000000a'),
  'B could not rename A product');
select rls_test.expect((select count(*) = 1 from public.memberships), 'B could not remove A owner');
insert into public.invites (business_id, email) values
  (current_setting('test.biz_a')::uuid, 'owner-b@rls-test.invalid'),
  (current_setting('test.biz_a')::uuid, 'other@rls-test.invalid');
do $$
begin
  insert into public.invites (business_id, email, role)
    values (current_setting('test.biz_a')::uuid, 'someone@rls-test.invalid', 'owner');
  raise exception 'RLS CHECK FAILED: invite created with owner role';
exception when insufficient_privilege then null;
end $$;

reset role;
select rls_test.act_as('b');
set local role authenticated;
select rls_test.expect((select public.accept_invites() = 1), 'B joins A through the invite');
select rls_test.expect((select count(*) = 2 from public.businesses), 'B now sees both businesses');
select rls_test.expect(
  (select role = 'staff' from public.memberships
   where business_id = current_setting('test.biz_a')::uuid and user_id = '00000000-0000-4000-a000-00000000000b'),
  'B joined A as staff');
insert into public.daily_entries (business_id, product_id, date, produced, wasted)
  values (current_setting('test.biz_a')::uuid, '00000000-0000-4000-c000-00000000000a', '2026-10-06', 100, 10);
update public.products set name = 'Staff rename' where id = '00000000-0000-4000-c000-00000000000a';
delete from public.memberships where business_id = current_setting('test.biz_a')::uuid;
do $$
begin
  insert into public.products (business_id, group_id, name)
    values (current_setting('test.biz_a')::uuid, '00000000-0000-4000-b000-00000000000a', 'Staff product');
  raise exception 'RLS CHECK FAILED: staff added a product';
exception when insufficient_privilege then null;
end $$;
select rls_test.expect((select count(*) = 0 from public.invites), 'staff cannot see invites');

reset role;
select rls_test.act_as('a');
set local role authenticated;
select rls_test.expect((select count(*) = 2 from public.memberships), 'staff could not remove anyone');
select rls_test.expect(
  (select name = 'White bread' from public.products where id = '00000000-0000-4000-c000-00000000000a'),
  'staff could not rename a product');
select rls_test.expect((select count(*) = 2 from public.daily_entries), 'A sees the number staff entered');
select rls_test.expect(
  (select count(*) = 1 and min(email) = 'other@rls-test.invalid' from public.invites),
  'accepted invite was cleared, the other one kept');

-- 4. Data rules: can't throw away more than was produced.
do $$
begin
  update public.daily_entries set wasted = 500 where date = '2026-10-05';
  raise exception 'RLS CHECK FAILED: wasted > produced was accepted';
exception when check_violation then null;
end $$;

-- 5. Owner A removes staff B; B loses access.
delete from public.memberships
  where business_id = current_setting('test.biz_a')::uuid and user_id = '00000000-0000-4000-a000-00000000000b';
reset role;
select rls_test.act_as('b');
set local role authenticated;
select rls_test.expect((select count(*) = 0 from public.products), 'removed staff loses access');

-- 6. Logged-out visitors get nothing.
reset role;
set local role anon;
do $$
begin
  perform 1 from public.products;
  raise exception 'RLS CHECK FAILED: anon could read products';
exception when insufficient_privilege then null;
end $$;

reset role;
select 'ALL RLS CHECKS PASSED' as result;

rollback;
