# production-tracker

Web + mobile app (installable PWA) for small producers to log how much of each
product they make and throw away every day, with daily and weekly reports.
Bulgarian by default, English available. Intended for commercial use.
The spec is in [docs/SPEC.md](docs/SPEC.md).

## Status

**Demo build.** All screens work with three weeks of sample data, stored in the
browser's localStorage. There's no login or shared database yet; Supabase is next.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (dates, report maths)
npm run build      # type-check + production build into dist/
```

To try it on a phone on the same Wi-Fi, run `npm run dev -- --host` and open
the "Network" address it prints.

## Layout

```
src/
  data/       types, DataStore interface, demo localStorage store
  lib/        date helpers (Europe/Sofia, Mon–Sun weeks), report calculations
  i18n/       Bulgarian + English texts
  screens/    Today, Reports, Settings
  components/ Stepper and small shared pieces
```

Screens only talk to the `DataStore` interface (`src/data/types.ts`), so
switching from the demo store to Supabase doesn't touch the UI.
