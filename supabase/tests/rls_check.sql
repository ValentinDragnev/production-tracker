-- Checks that row-level security keeps businesses apart, and the rules
-- around staff, invites and deleting.
-- Everything runs in one transaction that is rolled back at the end, so the
-- database is left exactly as it was.
--
--   supabase db query --linked -f supabase/tests/rls_check.sql
--
-- Prints "ALL RLS CHECKS PASSED", or stops at the first failing check.
--
-- People: a = owner of Bakery A, b = owner of Bakery B, c = staff at A.

begin;

-- Throwaway users that only exist inside this transaction.
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000a', 'a@rls-test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000b', 'b@rls-test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000c', 'c@rls-test.invalid', 'authenticated', 'authenticated');

-- Helpers live in a scratch schema that disappears with the rollback.
create schema rls_test;
grant usage on schema rls_test to authenticated, anon;

create function rls_test.act_as(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '00000000-0000-4000-a000-00000000000' || who,
    'email', who || '@rls-test.invalid',
    'role', 'authenticated')::text, true);
end $$;

-- Fails the whole run with a readable message.
create function rls_test.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'RLS CHECK FAILED: %', label;
  end if;
end $$;

-- Runs a statement that must be refused with the given error message.
create function rls_test.expect_refused(stmt text, reason text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'RLS CHECK FAILED: %', label;
exception when raise_exception then
  if sqlerrm <> reason then
    raise exception 'RLS CHECK FAILED: % (got "%")', label, sqlerrm;
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
select rls_test.expect_refused('select public.create_business(''Second bakery'')', 'already_in_business',
  'owner created a second business');
update public.businesses set name = 'Bakery A renamed' where id = current_setting('test.biz_a')::uuid;
select rls_test.expect((select name = 'Bakery A renamed' from public.businesses), 'owner can rename the business');

-- 2. Owner B, in another business, sees nothing of A and can't change it.
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

-- None of these touch A's rows.
update public.products set name = 'Hacked' where id = '00000000-0000-4000-c000-00000000000a';
update public.businesses set name = 'Hacked' where id = current_setting('test.biz_a')::uuid;
delete from public.memberships where business_id = current_setting('test.biz_a')::uuid;
delete from public.products where id = '00000000-0000-4000-c000-00000000000a';
delete from public.product_groups where id = '00000000-0000-4000-b000-00000000000a';

-- 3. A invites C as staff. Emails that already belong to a business can't be invited.
reset role;
select rls_test.act_as('a');
set local role authenticated;
select rls_test.expect(
  (select name = 'White bread' from public.products where id = '00000000-0000-4000-c000-00000000000a'),
  'B could not rename or delete A product');
select rls_test.expect((select name = 'Bakery A renamed' from public.businesses), 'B could not rename A');
select rls_test.expect((select count(*) = 1 from public.product_groups), 'B could not delete A group');
select rls_test.expect((select count(*) = 1 from public.memberships), 'B could not remove A owner');
insert into public.invites (business_id, email) values
  (current_setting('test.biz_a')::uuid, 'c@rls-test.invalid'),
  (current_setting('test.biz_a')::uuid, 'other@rls-test.invalid');
select rls_test.expect_refused(
  format('insert into public.invites (business_id, email) values (%L, %L)', current_setting('test.biz_a'), 'b@rls-test.invalid'),
  'email_in_use', 'invited the owner of another business');
select rls_test.expect_refused(
  format('insert into public.invites (business_id, email) values (%L, %L)', current_setting('test.biz_a'), 'a@rls-test.invalid'),
  'email_in_use', 'owner invited themselves');
do $$
begin
  insert into public.invites (business_id, email, role)
    values (current_setting('test.biz_a')::uuid, 'someone@rls-test.invalid', 'owner');
  raise exception 'RLS CHECK FAILED: invite created with owner role';
exception when insufficient_privilege then null;
end $$;

-- B can't invite C while C has A's invite pending.
reset role;
select rls_test.act_as('b');
set local role authenticated;
select rls_test.expect_refused(
  format('insert into public.invites (business_id, email) values (%L, %L)', current_setting('test.biz_b'), 'c@rls-test.invalid'),
  'email_in_use', 'email invited by two businesses');

-- 4. C logs in, joins A, enters numbers, but can't manage anything.
reset role;
select rls_test.act_as('c');
set local role authenticated;
select rls_test.expect((select public.accept_invites() = 1), 'C joins A through the invite');
select rls_test.expect((select count(*) = 1 from public.businesses), 'C sees only A');
select rls_test.expect(
  (select role = 'staff' from public.memberships where user_id = '00000000-0000-4000-a000-00000000000c'),
  'C joined A as staff');
select rls_test.expect_refused('select public.create_business(''My own bakery'')', 'already_in_business',
  'staff created their own business');
insert into public.daily_entries (business_id, product_id, date, produced, wasted)
  values (current_setting('test.biz_a')::uuid, '00000000-0000-4000-c000-00000000000a', '2026-10-06', 100, 10);
update public.products set name = 'Staff rename' where id = '00000000-0000-4000-c000-00000000000a';
update public.businesses set name = 'Staff rename' where id = current_setting('test.biz_a')::uuid;
delete from public.memberships where business_id = current_setting('test.biz_a')::uuid;
delete from public.products where id = '00000000-0000-4000-c000-00000000000a';
delete from public.product_groups where id = '00000000-0000-4000-b000-00000000000a';
do $$
begin
  insert into public.products (business_id, group_id, name)
    values (current_setting('test.biz_a')::uuid, '00000000-0000-4000-b000-00000000000a', 'Staff product');
  raise exception 'RLS CHECK FAILED: staff added a product';
exception when insufficient_privilege then null;
end $$;
select rls_test.expect((select count(*) = 0 from public.invites), 'staff cannot see invites');

-- B still can't invite C, now that C is A's staff.
reset role;
select rls_test.act_as('b');
set local role authenticated;
select rls_test.expect_refused(
  format('insert into public.invites (business_id, email) values (%L, %L)', current_setting('test.biz_b'), 'c@rls-test.invalid'),
  'email_in_use', 'invited another business''s staff');

reset role;
select rls_test.act_as('a');
set local role authenticated;
select rls_test.expect((select count(*) = 2 from public.memberships), 'staff could not remove anyone');
select rls_test.expect(
  (select name = 'White bread' from public.products where id = '00000000-0000-4000-c000-00000000000a'),
  'staff could not rename or delete a product');
select rls_test.expect((select name = 'Bakery A renamed' from public.businesses), 'staff could not rename the business');
select rls_test.expect((select count(*) = 1 from public.product_groups), 'staff could not delete a group');
select rls_test.expect((select count(*) = 2 from public.daily_entries), 'A sees the number staff entered');
select rls_test.expect(
  (select count(*) = 1 and min(email) = 'other@rls-test.invalid' from public.invites),
  'accepted invite was cleared, the other one kept');

-- 5. Data rules: can't throw away more than was produced.
do $$
begin
  update public.daily_entries set wasted = 500 where date = '2026-10-05';
  raise exception 'RLS CHECK FAILED: wasted > produced was accepted';
exception when check_violation then null;
end $$;

-- 6. Owner A deletes: a product takes its numbers with it, a group its products.
insert into public.products (id, business_id, group_id, name)
  values ('00000000-0000-4000-c000-0000000000a2', current_setting('test.biz_a')::uuid,
          '00000000-0000-4000-b000-00000000000a', 'Rye bread');
delete from public.products where id = '00000000-0000-4000-c000-00000000000a';
select rls_test.expect(
  (select count(*) = 0 from public.products where id = '00000000-0000-4000-c000-00000000000a'),
  'owner deleted a product');
select rls_test.expect((select count(*) = 0 from public.daily_entries), 'deleted product took its numbers with it');
delete from public.product_groups where id = '00000000-0000-4000-b000-00000000000a';
select rls_test.expect((select count(*) = 0 from public.product_groups), 'owner deleted a group');
select rls_test.expect((select count(*) = 0 from public.products), 'deleted group took its products with it');

-- 7. Owner A removes staff C; C loses access and is free to join elsewhere.
delete from public.memberships
  where business_id = current_setting('test.biz_a')::uuid and user_id = '00000000-0000-4000-a000-00000000000c';
reset role;
select rls_test.act_as('c');
set local role authenticated;
select rls_test.expect((select count(*) = 0 from public.businesses), 'removed staff loses access');
reset role;
select rls_test.act_as('b');
set local role authenticated;
insert into public.invites (business_id, email) values (current_setting('test.biz_b')::uuid, 'c@rls-test.invalid');
reset role;
select rls_test.act_as('c');
set local role authenticated;
select rls_test.expect((select public.accept_invites() = 1), 'removed staff can join another business');

-- 8. Logged-out visitors get nothing.
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
