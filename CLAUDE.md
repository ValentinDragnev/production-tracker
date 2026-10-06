# Production Tracker

Web + mobile (PWA) app for small Bulgarian producers to log daily production and
waste per product, with daily and weekly reports. Full spec: `docs/SPEC.md`.

This project is unrelated to the OfficeRnD templates in `~/Desktop/Templates`.
Don't apply template rules here.

## Stack

- React + TypeScript + Vite, installable PWA
- Supabase: Postgres, email OTP auth, row-level security (EU / Ireland, `eu-west-1`)
- i18n: Bulgarian default, English secondary. Never hard-code user-facing strings.

## Commands

- `npm run dev`: dev server on :5173
- `npm test`: vitest unit tests
- `npm run test:db`: migrations + RLS checks in PGlite (no Docker needed)
- `npm run build`: typecheck + production build

All text lives in `src/i18n/messages.ts`. Add every key in both `bg` and `en`.
Screens use only the `DataStore` interface in `src/data/types.ts`.

## Rules

- Users have low technical skill: big touch targets, few screens, plain words.
- Quantities are whole pieces. Dates are calendar days in Europe/Sofia.
  Weeks run Monday–Sunday.
- Enforce permissions in the database (RLS), not just in the UI. Every schema
  change gets a new file in `supabase/migrations/` and matching checks in
  `supabase/tests/rls_check.sql`; `npm run test:db` must pass.
- Never run `supabase db push` / `config push` against the live project
  without the user's go-ahead.
