# Production Tracker — Spec (v1)

## Problem

Small Bulgarian producers (bakeries, pastry shops, small kitchens) make more than
they sell. Returned or unsold production is thrown away at the end of the day or
week. They have no simple way to see how much they produce and how much they
throw away for each product, so they can't adjust production.

## Users

- **Owner**: sets up the business, products and groups, invites staff, sees reports.
- **Staff**: enters daily numbers. Can't change products or settings.
- Low technical skill. Mostly on a phone, sometimes on a computer.

## Decisions (locked 2026-10-06)

| Topic | Decision |
|---|---|
| Platform | One web app, installable on phones (PWA). No app stores in v1. |
| Login | Email + 6-digit code (no password). Session lasts months. |
| Data | Central database (Supabase, EU / Ireland `eu-west-1`) so phone and computer stay in sync. |
| Language | Bulgarian (default) + English, switchable. |
| Units | Per product / supply: бр., кг, л, торби, кутии. kg and l allow 2 decimals. Reports never add different units together. |
| Roles | Owner + staff. Owner invites staff by email. |
| Week | Monday–Sunday, timezone Europe/Sofia. |

## v1 features

1. **Login**: enter email, get a code, enter the code. A new user creates a business
   (just a name). An invited email lands straight in that business as staff.
2. **Products & groups** (owner): add, rename, reorder, hide or delete groups
   (e.g. Хляб, Баници, Сладкиши) and products in them. Hiding keeps history;
   deleting removes the numbers too, after a warning.
3. **Today screen** (everyone): products listed under their group. Each product has
   two big number fields, **Произведено** and **Изхвърлено**, with large +/−
   buttons. Values save automatically. A date picker lets you fix past days.
4. **Daily report**: for each product and group: produced, thrown away, and waste %.
   Worst waste % is highlighted.
5. **Weekly report**: totals by product and group, waste % for each day of the week,
   and a simple suggestion based on the week's average:
   "Average made 120, average thrown away 25 → try ~95–100."
6. **Staff** (owner): invite by email, remove.

## Stock and wording (added 2026-10-08)

- **Склад** tab: supplies (flour, sugar, ...) with a unit and an optional
  low-stock level. Per day: delivered and used. A **count** sets what is
  actually on the shelf at the end of a day; stock = latest count + later
  deliveries − later use (`supply_stock()` in the database, `computeStock`
  in the app). "За поръчка" lists supplies that are low or out.
- Everyone in the business records supplies (while the subscription is
  active); only the owner manages the supply list.
- The owner picks the wording of the two product numbers per business:
  Произведено / Изхвърлено, or Изпратено / Върнато for workshops that deliver
  to shops and get unsold goods back.

## Subscriptions and admin (added 2026-10-07)

- Every new business gets a **30-day free trial**, then pays **monthly or
  yearly**. Prices and bank-transfer details are set in the admin panel and
  shown to owners when they need to pay.
- When neither the trial nor a paid period covers today, or the admin locked
  the business, it can still **read reports but not enter numbers**. Enforced
  in the database (`private.is_active`), not just the UI. Nothing is deleted.
- Owners see a reminder in the last 7 days and a "how to pay" section in
  Settings. Staff are told to ask the owner.
- **Admin panel** (platform owner only, by email in `platform_admins`):
  customer list with status, activity and filters; per customer: record or
  delete payments, extend the trial, lock/unlock, phone and notes; prices and
  payment details. Payments extend access from the end of the current period
  (or from today if it already ended).
- Payment: a **Revolut** link (button + QR code, with the business name as
  the payment reference) and/or bank details, both set in the admin panel.
  Payments are recorded by the admin (bank, Revolut, card, cash, other);
  there is no automatic card processing. Stripe was dropped in favour of this.
- Customer contact: proizvodstvoibrak@gmail.com (editable in the admin
  panel), shown in Settings → Помощ and next to payment details. It is also
  meant to be the sender of all emails (login codes, reminders).
- Next: automatic reminder emails (7 days and 1 day before).

## Out of scope for v1

Sales and prices, money lost, multiple locations, offline-first sync, exports,
native store apps, monthly reports.

## Data model

```
businesses      id, name, created_at
memberships     business_id, user_id, role ('owner' | 'staff')
invites         business_id, email, role, created_at
product_groups  id, business_id, name, sort_order, archived
products        id, business_id, group_id, name, sort_order, archived
daily_entries   business_id, product_id, date, produced int, wasted int,
                updated_by, updated_at      UNIQUE (product_id, date)
```

Access rules (enforced in the database with row-level security, see
`supabase/migrations/` and the checks in `supabase/tests/rls_check.sql`):
- Members of a business can read everything in it and write `daily_entries`.
- Only owners can write groups, products, invites and memberships.
- `wasted` can't exceed `produced`, and both must be ≥ 0.
- Businesses are created only through `create_business()`, which makes the
  caller the owner. Invites turn into memberships through `accept_invites()`,
  which runs after every login and matches the verified login email.
- Logged-out visitors have no table access at all.
- One email belongs to at most one business, as owner or staff (unique
  membership per user). Emails already in a business, or already invited by
  another business, can't be invited; `create_business()` refuses callers who
  already belong to one. Removing staff frees their email again.
- Owners can rename the business, and delete groups and products. Deleting is
  permanent and cascades (group → products → daily numbers); hiding stays the
  default for products that are only paused.

## UX rules

- Big touch targets (at least 48px), big digits, high contrast.
- Never more than one main action per screen. No jargon.
- Bottom tab bar: **Днес** (Today) · **Отчети** (Reports) · **Настройки** (Settings).
