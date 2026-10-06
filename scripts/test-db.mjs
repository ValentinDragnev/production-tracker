// Runs the migrations and the RLS checks against an in-memory Postgres
// (PGlite), with small stand-ins for the parts of Supabase they rely on.
// Nothing touches the real project.
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const SUPABASE_STANDINS = `
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  -- Supabase grants table and function access by default; RLS does the rest.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;

  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (
    id uuid primary key,
    email text,
    aud text,
    role text
  );
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
`

const db = new PGlite()
await db.exec(SUPABASE_STANDINS)

for (const file of readdirSync('supabase/migrations').sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  console.log(`applied ${file}`)
}

let results
try {
  results = await db.exec(readFileSync('supabase/tests/rls_check.sql', 'utf8'))
} catch (err) {
  // Only the message: the error object also carries the whole SQL script.
  console.error(`FAILED: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
const passed = results.some((r) => r.rows.some((row) => row.result === 'ALL RLS CHECKS PASSED'))
if (!passed) {
  console.error('FAILED: RLS checks did not report success')
  process.exit(1)
}
console.log('ALL RLS CHECKS PASSED')
