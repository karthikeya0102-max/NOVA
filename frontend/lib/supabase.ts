import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  if (!client) {
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}

export async function authorizationHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient()
  if (!supabase) return {}
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error('Could not read the NOVA sign-in session. Sign in again.')
  if (!data.session?.access_token) throw new Error('Your NOVA session has expired. Sign in again.')
  return { Authorization: `Bearer ${data.session.access_token}` }
}
