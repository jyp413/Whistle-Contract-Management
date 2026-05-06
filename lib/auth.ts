import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/types/database';

export type AppUser = Database['public']['Tables']['users']['Row'];

export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();
  return data ?? null;
}

export async function requireUser(): Promise<AppUser> {
  const u = await getCurrentUser();
  if (!u) redirect('/login');
  if (u.deleted_at) redirect('/login');
  if (!u.is_active) redirect('/pending');
  return u;
}

export async function requireWriter(): Promise<AppUser> {
  const u = await requireUser();
  if (u.role !== 'master' && u.role !== 'accounting') {
    redirect('/dashboard?error=forbidden');
  }
  return u;
}

export async function requireMaster(): Promise<AppUser> {
  const u = await requireUser();
  if (u.role !== 'master') {
    redirect('/dashboard?error=forbidden');
  }
  return u;
}
