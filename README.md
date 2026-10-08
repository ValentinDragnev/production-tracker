# production-tracker

Web + mobile app (installable PWA) for small producers to log how much of each
product they make and throw away every day, with daily and weekly reports.
Bulgarian by default, English available. Intended for commercial use.
The spec is in [docs/SPEC.md](docs/SPEC.md).

## Status

Login by email code, one database shared by all customers, and each business's
data kept apart by row-level security in the database. Owners manage products
and staff; staff enter the daily numbers.

Without Supabase settings the app runs in **demo mode**: sample data in the
browser, no login.

## Run it

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase URL and publishable key
npm run dev                  # http://localhost:5173
```

To try it on a phone on the same Wi-Fi, run `npm run dev -- --host` and open
the "Network" address it prints.

## Checks

```bash
npm test           # unit tests (dates, report maths)
npm run test:db    # migrations + row-level security checks, in-memory Postgres
npm run build      # type-check + production build into dist/
```

## Database (Supabase)

Schema changes live in `supabase/migrations/`; auth settings and the login
email in `supabase/config.toml` and `supabase/templates/`.

```bash
supabase db push        # apply new migrations to the linked project
supabase config diff    # preview auth setting changes
supabase config push    # apply them
```

## Layout

```
src/
  auth/       session, login, business setup
  data/       types, DataStore interface, Supabase + demo stores, staff
  lib/        dates (Europe/Sofia, Mon–Sun weeks), reports, units, stock, subscription
  i18n/       Bulgarian + English texts
  screens/    Today, Stock, Reports, Settings, Admin
  components/ Stepper and small shared pieces
```

Screens only talk to the `DataStore` interface (`src/data/types.ts`), so the
same UI runs on Supabase or on the demo store.
