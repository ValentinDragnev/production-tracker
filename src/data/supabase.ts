import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/** null when the app runs in demo mode (no Supabase settings in .env.local). */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        // Implicit flow so the login link in the email also works when it
        // opens in a different browser than the one that asked for it.
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
      })
    : null
