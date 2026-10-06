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
| Units | Pieces only (whole numbers). |
| Roles | Owner + staff. Owner invites staff by email. |
| Week | Monday–Sunday, timezone Europe/Sofia. |

## v1 features

1. **Login**: enter email, get a code, enter the code. A new user creates a business
   (just a name). An invited email lands straight in that business as staff.
2. **Products & groups** (owner): add, rename, reorder or archive groups
   (e.g. Хляб, Баници, Сладкиши) and products in them. Archiving never deletes history.
3. **Today screen** (everyone): products listed under their group. Each product has
   two big number fields, **Произведено** and **Изхвърлено**, with large +/−
   buttons. Values save automatically. A date picker lets you fix past days.
4. **Daily report**: for each product and group: produced, thrown away, and waste %.
   Worst waste % is highlighted.
5. **Weekly report**: totals by product and group, waste % for each day of the week,
   and a simple suggestion based on the week's average:
   "Average made 120, average thrown away 25 → try ~95–100."
6. **Staff** (owner): invite by email, remove.

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

## UX rules

- Big touch targets (at least 48px), big digits, high contrast.
- Never more than one main action per screen. No jargon.
- Bottom tab bar: **Днес** (Today) · **Отчети** (Reports) · **Настройки** (Settings).
