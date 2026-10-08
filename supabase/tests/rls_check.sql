-- Checks that row-level security keeps businesses apart, and the rules
-- around staff, invites and deleting.
-- Everything runs in one transaction that is rolled back at the end, so the
-- database is left exactly as it was.
--
--   supabase db query --linked -f supabase/tests/rls_check.sql
--
-- Prints "ALL RLS CHECKS PASSED", or stops at the first failing check.
--
-- People: a = owner of Bakery A, b = owner of Bakery B, c = staff at A,
-- d = the app's admin (platform owner).

begin;

-- Throwaway users that only exist inside this transaction.
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000a', 'a@rls-test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000b', 'b@rls-test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000c', 'c@rls-test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000d', 'd@rls-test.invalid', 'authenticated', 'authenticated');
insert into public.platform_admins (email) values ('d@rls-test.invalid');

-- Helpers live in a scratch schema that disappears with the rollback.
create schema rls_test;
grant usage on schema rls_test to authenticated, anon, service_role;

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

-- Runs a statement that must fail with the given error message (or, when
-- reason is 'denied', with any permission / row-level security error).
create function rls_test.expect_refused(stmt text, reason text, label text) returns void language plpgsql as $$
declare
  ran boolean := false;
begin
  begin
    execute stmt;
    ran := true;
  exception when others then
    if not (sqlerrm = reason or (reason = 'denied' and sqlstate = '42501')) then
      raise exception 'RLS CHECK FAILED: % (got "%")', label, sqlerrm;
    end if;
  end;
  if ran then
    raise exception 'RLS CHECK FAILED: %', label;
  end if;
end $$;

grant execute on all functions in schema rls_test to authenticated, anon, service_role;

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

-- 8. Subscriptions: a 30-day trial, then only the admin can extend or lock.
reset role;
select rls_test.act_as('a');
set local role authenticated;
select rls_test.expect(
  (select trial_ends_at between now() + interval '29 days' and now() + interval '31 days' from public.subscriptions),
  'new business gets a 30-day trial');
select rls_test.expect((select count(*) = 1 from public.app_settings), 'members can read prices');
update public.subscriptions set locked = true, paid_until = now() + interval '10 years';
select rls_test.expect((select not locked and paid_until is null from public.subscriptions),
  'members cannot change their subscription');
select rls_test.expect_refused('select * from public.payments', 'denied', 'members can read payments');
select rls_test.expect_refused('select * from public.customer_notes', 'denied', 'members can read admin notes');
select rls_test.expect_refused('select * from public.platform_admins', 'denied', 'members can read the admin list');
select rls_test.expect_refused('select * from public.admin_customers()', 'not_admin', 'owner opened the admin overview');
select rls_test.expect_refused(
  format('select public.admin_record_payment(%L, 0, 12, %L)', current_setting('test.biz_a'), 'cash'),
  'not_admin', 'owner recorded their own payment');
select rls_test.expect_refused(
  format('select public.admin_set_trial_end(%L, now() + interval ''5 years'')', current_setting('test.biz_a')),
  'not_admin', 'owner extended their own trial');
select rls_test.expect((select not public.am_i_admin()), 'owner is not an admin');
insert into public.product_groups (id, business_id, name)
  values ('00000000-0000-4000-b000-0000000000a3', current_setting('test.biz_a')::uuid, 'Pastry');
insert into public.products (id, business_id, group_id, name)
  values ('00000000-0000-4000-c000-0000000000a3', current_setting('test.biz_a')::uuid,
          '00000000-0000-4000-b000-0000000000a3', 'Croissant');

-- The admin sees every business and locks A.
reset role;
select rls_test.act_as('d');
set local role authenticated;
select rls_test.expect(public.am_i_admin(), 'admin is recognised');
select rls_test.expect((select count(*) = 2 from public.admin_customers()), 'admin sees all businesses');
select rls_test.expect(
  (select owner_email = 'a@rls-test.invalid' from public.admin_customers() where business_id = current_setting('test.biz_a')::uuid),
  'admin overview shows the owner');
select rls_test.expect((select count(*) = 0 from public.products), 'admin does not see business data directly');
select public.admin_set_locked(current_setting('test.biz_a')::uuid, true);

-- Locked: A can read but not enter numbers.
reset role;
select rls_test.act_as('a');
set local role authenticated;
select rls_test.expect((select count(*) = 1 from public.products), 'locked business can still read');
select rls_test.expect_refused(
  format('insert into public.daily_entries (business_id, product_id, date, produced, wasted) values (%L, %L, %L, 10, 1)',
    current_setting('test.biz_a'), '00000000-0000-4000-c000-0000000000a3', '2026-10-07'),
  'denied', 'locked business entered numbers');

-- Unlocked but trial over: still no entries until a payment is recorded.
reset role;
select rls_test.act_as('d');
set local role authenticated;
select public.admin_set_locked(current_setting('test.biz_a')::uuid, false);
select public.admin_set_trial_end(current_setting('test.biz_a')::uuid, now() - interval '1 day');
reset role;
select rls_test.act_as('a');
set local role authenticated;
select rls_test.expect_refused(
  format('insert into public.daily_entries (business_id, product_id, date, produced, wasted) values (%L, %L, %L, 10, 1)',
    current_setting('test.biz_a'), '00000000-0000-4000-c000-0000000000a3', '2026-10-07'),
  'denied', 'expired trial entered numbers');

reset role;
select rls_test.act_as('d');
set local role authenticated;
select set_config('test.paid_until',
  public.admin_record_payment(current_setting('test.biz_a')::uuid, 15, 1, 'bank')::text, true);
select rls_test.expect(
  current_setting('test.paid_until')::timestamptz = now() + interval '1 month',
  'a monthly payment after expiry runs a month from today');
-- Paying early, during the trial, adds the paid period after the trial.
select rls_test.expect(
  (select public.admin_record_payment(current_setting('test.biz_b')::uuid, 150, 12, 'revolut')
     = (select trial_ends_at from public.admin_customers() where business_id = current_setting('test.biz_b')::uuid)
       + interval '12 months'),
  'a yearly payment during the trial starts when the trial ends');
select rls_test.expect(
  (select plan = 'monthly' and total_paid = 15 from public.admin_customers()
   where business_id = current_setting('test.biz_a')::uuid),
  'payment shows in the overview');
select public.admin_save_notes(current_setting('test.biz_a')::uuid, '0888 123 456', 'Paid by bank');
select public.admin_save_settings(15, 150, 'IBAN BG00 TEST', 'IBAN BG00 TEST', 'https://revolut.me/test', 'Help@Example.com');

reset role;
select rls_test.act_as('a');
set local role authenticated;
insert into public.daily_entries (business_id, product_id, date, produced, wasted)
  values (current_setting('test.biz_a')::uuid, '00000000-0000-4000-c000-0000000000a3', '2026-10-07', 10, 1);
select rls_test.expect((select count(*) = 1 from public.daily_entries), 'paid business enters numbers again');
select rls_test.expect((select monthly_price = 15 from public.app_settings), 'members see the prices the admin set');
select rls_test.expect(
  (select revolut_link = 'https://revolut.me/test' and contact_email = 'help@example.com' from public.app_settings),
  'members see the Revolut link and contact email');
select rls_test.expect_refused(
  'select public.admin_save_settings(1, 1, '''', '''', ''https://evil.example'', '''')',
  'not_admin', 'owner changed the payment link');
select rls_test.expect((select paid_until > now() from public.subscriptions), 'member sees their paid period');

-- Deleting the payment (recorded by mistake) takes access away again.
reset role;
select rls_test.act_as('d');
set local role authenticated;
select public.admin_delete_payment((select id from public.admin_payments(current_setting('test.biz_a')::uuid)));
reset role;
select rls_test.act_as('a');
set local role authenticated;
select rls_test.expect_refused(
  format('insert into public.daily_entries (business_id, product_id, date, produced, wasted) values (%L, %L, %L, 10, 1)',
    current_setting('test.biz_a'), '00000000-0000-4000-c000-0000000000a3', '2026-10-08'),
  'denied', 'numbers entered after the payment was removed');

-- 9. Units, wording and supplies. B is active (trial + yearly payment); C is
-- now B's staff (joined in step 7).
reset role;
select rls_test.act_as('b');
set local role authenticated;
update public.businesses set entry_labels = 'sent_returned' where id = current_setting('test.biz_b')::uuid;
select rls_test.expect((select entry_labels = 'sent_returned' from public.businesses), 'owner sets the wording');
insert into public.products (id, business_id, group_id, name, unit)
  values ('00000000-0000-4000-c000-0000000000b1', current_setting('test.biz_b')::uuid,
          '00000000-0000-4000-b000-00000000000b', 'Cream', 'kg');
insert into public.daily_entries (business_id, product_id, date, produced, wasted)
  values (current_setting('test.biz_b')::uuid, '00000000-0000-4000-c000-0000000000b1', '2026-10-07', 2.5, 0.25);
select rls_test.expect((select produced = 2.5 and wasted = 0.25 from public.daily_entries), 'kg products keep decimals');
select rls_test.expect_refused(
  format('insert into public.products (business_id, group_id, name, unit) values (%L, %L, %L, %L)',
    current_setting('test.biz_b'), '00000000-0000-4000-b000-00000000000b', 'Odd', 'tons'),
  'new row for relation "products" violates check constraint "products_unit_check"', 'unknown unit accepted');

insert into public.supplies (id, business_id, name, unit, low_stock_at) values
  ('00000000-0000-4000-d000-0000000000b1', current_setting('test.biz_b')::uuid, 'Flour', 'kg', 10),
  ('00000000-0000-4000-d000-0000000000b2', current_setting('test.biz_b')::uuid, 'Sugar', 'kg', null);
insert into public.supply_days (business_id, supply_id, date, received, used, counted) values
  (current_setting('test.biz_b')::uuid, '00000000-0000-4000-d000-0000000000b1', '2026-10-01', 25, 0, null),
  (current_setting('test.biz_b')::uuid, '00000000-0000-4000-d000-0000000000b1', '2026-10-02', 0, 3, 20),
  (current_setting('test.biz_b')::uuid, '00000000-0000-4000-d000-0000000000b1', '2026-10-03', 0, 5.5, null),
  (current_setting('test.biz_b')::uuid, '00000000-0000-4000-d000-0000000000b2', '2026-10-01', 5, 2, null);

-- Staff record deliveries and use, but can't manage the supply list.
reset role;
select rls_test.act_as('c');
set local role authenticated;
insert into public.supply_days (business_id, supply_id, date, received, used)
  values (current_setting('test.biz_b')::uuid, '00000000-0000-4000-d000-0000000000b1', '2026-10-04', 10, 0);
select rls_test.expect(
  (select stock = 24.5 and counted_on = '2026-10-02' from public.supply_stock(current_setting('test.biz_b')::uuid)
   where supply_id = '00000000-0000-4000-d000-0000000000b1'),
  'stock = last count + later deliveries - later use');
select rls_test.expect(
  (select stock = 3 and counted_on is null from public.supply_stock(current_setting('test.biz_b')::uuid)
   where supply_id = '00000000-0000-4000-d000-0000000000b2'),
  'stock without a count starts from zero');
select rls_test.expect_refused(
  format('insert into public.supplies (business_id, name) values (%L, %L)', current_setting('test.biz_b'), 'Staff supply'),
  'denied', 'staff added a supply');
update public.supplies set name = 'Hacked' where id = '00000000-0000-4000-d000-0000000000b1';
delete from public.supplies where id = '00000000-0000-4000-d000-0000000000b2';
update public.businesses set entry_labels = 'made_thrown';

-- Another business sees none of it and can't record into it.
reset role;
select rls_test.act_as('a');
set local role authenticated;
select rls_test.expect((select count(*) = 0 from public.supplies), 'A cannot see B supplies');
select rls_test.expect((select count(*) = 0 from public.supply_stock(current_setting('test.biz_b')::uuid)),
  'A cannot read B stock');
select rls_test.expect_refused(
  format('insert into public.supply_days (business_id, supply_id, date, received) values (%L, %L, %L, 1)',
    current_setting('test.biz_b'), '00000000-0000-4000-d000-0000000000b1', '2026-10-05'),
  'denied', 'A recorded supplies for B');

reset role;
select rls_test.act_as('b');
set local role authenticated;
select rls_test.expect(
  (select count(*) = 2 and bool_and(name <> 'Hacked') from public.supplies), 'staff could not change or delete supplies');
select rls_test.expect((select entry_labels = 'sent_returned' from public.businesses), 'staff could not change the wording');

-- A locked business can't record supplies either.
reset role;
select rls_test.act_as('d');
set local role authenticated;
select public.admin_set_locked(current_setting('test.biz_b')::uuid, true);
reset role;
select rls_test.act_as('c');
set local role authenticated;
select rls_test.expect_refused(
  format('insert into public.supply_days (business_id, supply_id, date, used) values (%L, %L, %L, 1)',
    current_setting('test.biz_b'), '00000000-0000-4000-d000-0000000000b1', '2026-10-06'),
  'denied', 'locked business recorded supplies');

-- Deleting a supply takes its history with it.
reset role;
select rls_test.act_as('d');
set local role authenticated;
select public.admin_set_locked(current_setting('test.biz_b')::uuid, false);
reset role;
select rls_test.act_as('b');
set local role authenticated;
delete from public.supplies where id = '00000000-0000-4000-d000-0000000000b1';
select rls_test.expect((select count(*) = 1 from public.supply_days), 'deleted supply took its days with it');

-- 10. Reminder emails: only the server can claim them, each goes out once.
-- Here A's trial ended yesterday (payment removed); B is paid for a year.
-- A also gets a staff member, who must not receive the owner's reminders.
reset role;
insert into auth.users (id, email, aud, role)
  values ('00000000-0000-4000-a000-00000000000e', 'e@rls-test.invalid', 'authenticated', 'authenticated');
insert into public.memberships (business_id, user_id, email, role)
  values (current_setting('test.biz_a')::uuid, '00000000-0000-4000-a000-00000000000e', 'e@rls-test.invalid', 'staff');
select rls_test.act_as('a');
set local role authenticated;
select rls_test.expect_refused('select * from public.claim_due_reminders()', 'denied', 'owner claimed reminders');
select rls_test.expect_refused('select * from public.reminder_log', 'denied', 'owner read the reminder log');

reset role;
set local role service_role;
create temp table claimed1 as select * from public.claim_due_reminders();
select rls_test.expect(
  (select count(*) = 1 and bool_and(kind = 'ended' and is_trial and owner_emails = array['a@rls-test.invalid'])
   from claimed1),
  'ended trial is due once, to the owner');
select rls_test.expect((select count(*) = 0 from public.claim_due_reminders()), 'a claimed reminder is not sent twice');

-- A new period end brings new reminders: a week before, then a day before.
reset role;
select rls_test.act_as('d');
set local role authenticated;
select public.admin_set_trial_end(current_setting('test.biz_a')::uuid, now() + interval '5 days');
reset role;
set local role service_role;
select rls_test.expect((select count(*) = 1 and min(kind) = 'week' from public.claim_due_reminders()), 'week reminder');
reset role;
select rls_test.act_as('d');
set local role authenticated;
select public.admin_set_trial_end(current_setting('test.biz_a')::uuid, now() + interval '12 hours');
reset role;
set local role service_role;
create temp table claimed2 as select * from public.claim_due_reminders();
select rls_test.expect((select count(*) = 1 and min(kind) = 'day' from claimed2), 'day reminder');

-- A failed email is released and comes back on the next run.
select public.release_reminder((select log_id from claimed2));
select rls_test.expect((select count(*) = 1 and min(kind) = 'day' from public.claim_due_reminders()), 'released reminder retried');

-- Locked businesses get no reminders.
reset role;
select rls_test.act_as('d');
set local role authenticated;
select public.admin_set_trial_end(current_setting('test.biz_a')::uuid, now() + interval '6 days');
select public.admin_set_locked(current_setting('test.biz_a')::uuid, true);
reset role;
set local role service_role;
select rls_test.expect((select count(*) = 0 from public.claim_due_reminders()), 'locked business gets no reminder');

-- 11. Logged-out visitors get nothing.
reset role;
set local role anon;
do $$
begin
  perform 1 from public.products;
  raise exception 'RLS CHECK FAILED: anon could read products';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform 1 from public.supplies;
  raise exception 'RLS CHECK FAILED: anon could read supplies';
exception when insufficient_privilege then null;
end $$;

reset role;
select 'ALL RLS CHECKS PASSED' as result;

rollback;
