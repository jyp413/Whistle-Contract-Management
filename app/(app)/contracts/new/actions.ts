'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireWriter } from '@/lib/auth';

const Schema = z.object({
  local_government_id: z.string().uuid(),
  signed_date: z.string().nullable(),
  effective_date: z.string().nullable(),
  expiry_date: z.string().nullable(),
  extended_expiry_date: z.string().nullable(),
  memo: z.string().nullable(),
});

export async function createContractAction(input: unknown): Promise<
  | { error: string; id?: undefined }
  | { error?: undefined; id: string }
> {
  const me = await requireWriter();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return { error: '입력값이 올바르지 않습니다.' };
  }
  const v = parsed.data;

  if (v.expiry_date && v.effective_date && v.expiry_date < v.effective_date) {
    return { error: '계약만료일은 시작일 이후여야 합니다.' };
  }

  const today = new Date().toISOString().slice(0, 10);

  if (v.expiry_date && v.expiry_date < today) {
    if (!v.extended_expiry_date) {
      return { error: '만료일이 이미 지난 계약입니다. 연장 후 만료일을 함께 입력하세요.' };
    }
    if (v.extended_expiry_date <= v.expiry_date) {
      return { error: '연장 후 만료일은 기존 만료일 이후여야 합니다.' };
    }
    if (v.extended_expiry_date < today) {
      return { error: '연장 후 만료일도 이미 지났습니다. 현재 유효한 만료일을 입력하세요.' };
    }
  }

  if (v.extended_expiry_date && v.expiry_date && v.extended_expiry_date <= v.expiry_date) {
    return { error: '연장 후 만료일은 기존 만료일 이후여야 합니다.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('contracts')
    .insert({
      local_government_id: v.local_government_id,
      status: 'in_progress',
      signed_date: v.signed_date,
      effective_date: v.effective_date,
      expiry_date: v.expiry_date,
      extended_expiry_date: v.extended_expiry_date,
      memo: v.memo,
      created_by: me.id,
      updated_by: me.id,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { error: error?.message ?? '등록 실패' };
  }

  // 상태 이력 + 활동 로그 기록 (best-effort)
  await supabase.from('contract_status_history').insert({
    contract_id: data.id,
    from_status: null,
    to_status: 'in_progress',
    transition_type: 'create',
    trigger_event: 'contract_create',
    changed_by: me.id,
  });

  if (v.extended_expiry_date && v.expiry_date) {
    await supabase.from('contract_extensions').insert({
      contract_id: data.id,
      previous_expiry_date: v.expiry_date,
      new_expiry_date: v.extended_expiry_date,
      reason: '초기 등록 시 입력된 연장 정보',
      extended_by: me.id,
    });
  }

  await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'contract_create',
    target_type: 'contract',
    target_id: data.id,
    after_value: {
      local_government_id: v.local_government_id,
      status: 'in_progress',
      signed_date: v.signed_date,
      effective_date: v.effective_date,
      expiry_date: v.expiry_date,
      extended_expiry_date: v.extended_expiry_date,
    },
  });

  return { id: data.id };
}
