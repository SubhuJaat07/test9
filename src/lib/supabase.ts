import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Server-side client with admin access
export function getSupabaseServer() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

// Client-side client with anon key
export function getSupabaseClient() {
  return createClient(supabaseUrl, supabaseAnonKey);
}

export function isSupabaseConfigured() {
  return !!(supabaseUrl && supabaseServiceKey);
}
