'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireMaster } from '@/lib/auth';

const RoleSchema = z.enum(['master', 'accounting', 'viewer']);

export async function updateUserRole(input: {
  userId: string;
  role: 'master' | 'accounting' | 'viewer';
}): Promise<{ error?: string; ok?: true }> {
  const me = await requireMaster();
  const parsed = RoleSchema.safeParse(input.role);
  if (!parsed.success) return { error: '잘못된 역할입니다.' };
  if (input.userId === me.id && parsed.data !== 'master') {
    return { error: '본인의 Master 권한은 해제할 수 없습니다.' };
  }

  const supabase = await createClient();

  const { data: target } = await supabase
    .from('users')
    .select('role, email')
    .eq('id', input.userId)
    .single();

  if (!target) return { error: '사용자를 찾을 수 없습니다.' };

  const { error } = await supabase
    .from('users')
    .update({ role: parsed.data })
    .eq('id', input.userId);

  if (error) return { error: error.message };

  await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'permission_change',
    target_type: 'user',
    target_id: input.userId,
    before_value: { role: target.role, email: target.email },
    after_value: { role: parsed.data, email: target.email },
  });

  revalidatePath('/users');
  return { ok: true };
}

export async function setUserActive(input: {
  userId: string;
  isActive: boolean;
}): Promise<{ error?: string; ok?: true }> {
  const me = await requireMaster();
  if (input.userId === me.id && !input.isActive) {
    return { error: '본인 계정은 비활성화할 수 없습니다.' };
  }

  const supabase = await createClient();

  // 현재 상태 조회 — soft-delete 된 사용자는 재활성화 거부 + before_value 로그 완비
  const { data: target } = await supabase
    .from('users')
    .select('is_active, deleted_at, email')
    .eq('id', input.userId)
    .single();
  if (!target) return { error: '사용자를 찾을 수 없습니다.' };
  if (target.deleted_at && input.isActive) {
    return { error: '탈퇴 처리된 사용자는 재활성화할 수 없습니다.' };
  }

  const { error } = await supabase
    .from('users')
    .update({ is_active: input.isActive })
    .eq('id', input.userId);

  if (error) return { error: error.message };

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'permission_change',
    target_type: 'user',
    target_id: input.userId,
    before_value: { is_active: target.is_active, email: target.email },
    after_value: { is_active: input.isActive, email: target.email },
  });
  if (logErr) console.error('[setUserActive] activity_logs insert failed:', logErr);

  revalidatePath('/users');
  return { ok: true };
}
