'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireWriter } from '@/lib/auth';

const Schema = z.object({
  local_government_id: z.string().uuid(),
  contracting_party: z.enum(['monoplatform', 'imcity']),
  contract_type: z.enum(['parking_enforcement', 'personal_info_outsourcing', 'mou', 'other']),
  master_contract_id: z.string().uuid().nullable(),
  signed_date: z.string().nullable(),
  effective_date: z.string().nullable(),
  expiry_date: z.string().nullable(),
  extended_expiry_date: z.string().nullable(),
  memo: z.string().nullable(),
  auto_renewal: z.boolean(),
  auto_renewal_period_months: z.number().int().positive().nullable(),
  auto_renewal_end_date: z.string().nullable(),
});

export type MasterContractSummary = {
  id: string;
  signed_date: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  extended_expiry_date: string | null;
  auto_renewal: boolean;
  auto_renewal_period_months: number | null;
  auto_renewal_end_date: string | null;
  status: string;
  contracting_party: string;
};

export async function listMasterContractsForLG(
  localGovernmentId: string,
): Promise<MasterContractSummary[]> {
  await requireWriter();
  const supabase = await createClient();
  const { data } = await supabase
    .from('contracts')
    .select(
      'id, signed_date, effective_date, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date, status, contracting_party',
    )
    .eq('local_government_id', localGovernmentId)
    .eq('contract_type', 'parking_enforcement')
    .is('master_contract_id', null)
    .is('deleted_at', null)
    .neq('status', 'terminated')
    .order('signed_date', { ascending: false });
  return data ?? [];
}

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

  if (v.contract_type === 'parking_enforcement') {
    if (v.master_contract_id !== null) {
      return { error: '주차단속 위수탁(메인) 계약은 메인 계약 연결을 가질 수 없습니다.' };
    }
  } else {
    if (!v.master_contract_id) {
      return { error: '부속 계약은 같은 지자체의 메인 계약을 선택해야 합니다.' };
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  if (v.auto_renewal) {
    if (!v.auto_renewal_period_months || v.auto_renewal_period_months < 1) {
      return { error: '자동연장 주기(개월)를 1 이상으로 입력하세요.' };
    }
    if (
      v.auto_renewal_end_date &&
      v.expiry_date &&
      v.auto_renewal_end_date < v.expiry_date
    ) {
      return { error: '자동연장 종료일은 계약만료일 이후여야 합니다.' };
    }
  }

  if (v.expiry_date && v.expiry_date < today && !v.auto_renewal) {
    if (!v.extended_expiry_date) {
      return { error: '만료일이 이미 지난 계약입니다. 연장 후 만료일을 함께 입력하거나 자동연장을 설정하세요.' };
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
      contracting_party: v.contracting_party,
      contract_type: v.contract_type,
      master_contract_id: v.master_contract_id,
      status: 'in_progress',
      signed_date: v.signed_date,
      effective_date: v.effective_date,
      expiry_date: v.expiry_date,
      extended_expiry_date: v.extended_expiry_date,
      memo: v.memo,
      auto_renewal: v.auto_renewal,
      auto_renewal_period_months: v.auto_renewal ? v.auto_renewal_period_months : null,
      auto_renewal_end_date: v.auto_renewal ? v.auto_renewal_end_date : null,
      created_by: me.id,
      updated_by: me.id,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { error: error?.message ?? '등록 실패' };
  }

  // 상태 이력 + 활동 로그 기록 (insert 에러 발생 시 server console 로깅)
  const { error: histErr } = await supabase.from('contract_status_history').insert({
    contract_id: data.id,
    from_status: null,
    to_status: 'in_progress',
    transition_type: 'create',
    trigger_event: 'contract_create',
    changed_by: me.id,
  });
  if (histErr) console.error('[createContractAction] status_history insert failed:', histErr);

  if (v.extended_expiry_date && v.expiry_date) {
    const { error: extErr } = await supabase.from('contract_extensions').insert({
      contract_id: data.id,
      previous_expiry_date: v.expiry_date,
      new_expiry_date: v.extended_expiry_date,
      reason: '초기 등록 시 입력된 연장 정보',
      extended_by: me.id,
    });
    if (extErr) console.error('[createContractAction] contract_extensions insert failed:', extErr);
  }

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'contract_create',
    target_type: 'contract',
    target_id: data.id,
    after_value: {
      local_government_id: v.local_government_id,
      contracting_party: v.contracting_party,
      contract_type: v.contract_type,
      master_contract_id: v.master_contract_id,
      status: 'in_progress',
      signed_date: v.signed_date,
      effective_date: v.effective_date,
      expiry_date: v.expiry_date,
      extended_expiry_date: v.extended_expiry_date,
      auto_renewal: v.auto_renewal,
      auto_renewal_period_months: v.auto_renewal ? v.auto_renewal_period_months : null,
      auto_renewal_end_date: v.auto_renewal ? v.auto_renewal_end_date : null,
    },
  });
  if (logErr) console.error('[createContractAction] activity_logs insert failed:', logErr);

  return { id: data.id };
}

// ============================================================
// Batch creation — 메인 + 부속 N개를 한 번에 등록
// 부속은 메인의 일자/자동연장을 그대로 상속 (도메인 룰: 부속은 메인에 종속)
// ============================================================

const SUPPLEMENT_TYPES = ['personal_info_outsourcing', 'mou', 'other'] as const;
type SupplementType = (typeof SUPPLEMENT_TYPES)[number];

const BatchSchema = z.object({
  local_government_id: z.string().uuid(),
  contracting_party: z.enum(['monoplatform', 'imcity']),
  include_main: z.boolean(),
  existing_master_id: z.string().uuid().nullable(),
  supplements: z.array(z.enum(SUPPLEMENT_TYPES)),
  signed_date: z.string().nullable(),
  effective_date: z.string().nullable(),
  expiry_date: z.string().nullable(),
  extended_expiry_date: z.string().nullable(),
  memo: z.string().nullable(),
  auto_renewal: z.boolean(),
  auto_renewal_period_months: z.number().int().positive().nullable(),
  auto_renewal_end_date: z.string().nullable(),
});

export type BatchCreatedItem = {
  id: string;
  contract_type:
    | 'parking_enforcement'
    | 'personal_info_outsourcing'
    | 'mou'
    | 'other';
};

export async function createContractBatch(input: unknown): Promise<
  | { error: string; created?: undefined }
  | { error?: undefined; created: BatchCreatedItem[] }
> {
  const me = await requireWriter();
  const parsed = BatchSchema.safeParse(input);
  if (!parsed.success) {
    return { error: '입력값이 올바르지 않습니다.' };
  }
  const v = parsed.data;

  const totalChecked = (v.include_main ? 1 : 0) + v.supplements.length;
  if (totalChecked === 0) {
    return { error: '생성할 계약을 최소 1개 이상 선택하세요.' };
  }

  if (!v.include_main && v.supplements.length > 0 && !v.existing_master_id) {
    return { error: '부속 계약만 등록할 때는 기존 메인 계약을 선택해야 합니다.' };
  }

  // 메인 자체 등록 시 일자 검증 (부속만 등록 시는 메인 일자가 사용됨)
  let datesSource: {
    signed_date: string | null;
    effective_date: string | null;
    expiry_date: string | null;
    extended_expiry_date: string | null;
    auto_renewal: boolean;
    auto_renewal_period_months: number | null;
    auto_renewal_end_date: string | null;
  };
  let mainId: string | null = null;
  const supabase = await createClient();

  if (v.include_main) {
    if (v.expiry_date && v.effective_date && v.expiry_date < v.effective_date) {
      return { error: '계약만료일은 시작일 이후여야 합니다.' };
    }
    const today = new Date().toISOString().slice(0, 10);
    if (v.auto_renewal) {
      if (!v.auto_renewal_period_months || v.auto_renewal_period_months < 1) {
        return { error: '자동연장 주기(개월)를 1 이상으로 입력하세요.' };
      }
      if (
        v.auto_renewal_end_date &&
        v.expiry_date &&
        v.auto_renewal_end_date < v.expiry_date
      ) {
        return { error: '자동연장 종료일은 계약만료일 이후여야 합니다.' };
      }
    }
    if (v.expiry_date && v.expiry_date < today && !v.auto_renewal) {
      if (!v.extended_expiry_date) {
        return {
          error:
            '만료일이 이미 지난 계약입니다. 연장 후 만료일을 함께 입력하거나 자동연장을 설정하세요.',
        };
      }
      if (v.extended_expiry_date <= v.expiry_date) {
        return { error: '연장 후 만료일은 기존 만료일 이후여야 합니다.' };
      }
      if (v.extended_expiry_date < today) {
        return {
          error:
            '연장 후 만료일도 이미 지났습니다. 현재 유효한 만료일을 입력하세요.',
        };
      }
    }
    if (
      v.extended_expiry_date &&
      v.expiry_date &&
      v.extended_expiry_date <= v.expiry_date
    ) {
      return { error: '연장 후 만료일은 기존 만료일 이후여야 합니다.' };
    }

    // 메인 INSERT
    const ins = await supabase
      .from('contracts')
      .insert({
        local_government_id: v.local_government_id,
        contracting_party: v.contracting_party,
        contract_type: 'parking_enforcement',
        master_contract_id: null,
        status: 'in_progress',
        signed_date: v.signed_date,
        effective_date: v.effective_date,
        expiry_date: v.expiry_date,
        extended_expiry_date: v.extended_expiry_date,
        memo: v.memo,
        auto_renewal: v.auto_renewal,
        auto_renewal_period_months: v.auto_renewal
          ? v.auto_renewal_period_months
          : null,
        auto_renewal_end_date: v.auto_renewal ? v.auto_renewal_end_date : null,
        created_by: me.id,
        updated_by: me.id,
      })
      .select('id')
      .single();
    if (ins.error || !ins.data) {
      return { error: ins.error?.message ?? '메인 계약 등록 실패' };
    }
    mainId = ins.data.id;
    await recordCreateSideEffects(supabase, me.id, mainId, {
      local_government_id: v.local_government_id,
      contracting_party: v.contracting_party,
      contract_type: 'parking_enforcement',
      master_contract_id: null,
      signed_date: v.signed_date,
      effective_date: v.effective_date,
      expiry_date: v.expiry_date,
      extended_expiry_date: v.extended_expiry_date,
      auto_renewal: v.auto_renewal,
      auto_renewal_period_months: v.auto_renewal
        ? v.auto_renewal_period_months
        : null,
      auto_renewal_end_date: v.auto_renewal ? v.auto_renewal_end_date : null,
    });

    datesSource = {
      signed_date: v.signed_date,
      effective_date: v.effective_date,
      expiry_date: v.expiry_date,
      extended_expiry_date: v.extended_expiry_date,
      auto_renewal: v.auto_renewal,
      auto_renewal_period_months: v.auto_renewal
        ? v.auto_renewal_period_months
        : null,
      auto_renewal_end_date: v.auto_renewal ? v.auto_renewal_end_date : null,
    };
  } else {
    // 부속만 등록 → 기존 메인의 일자/자동연장을 복사
    const masterRes = await supabase
      .from('contracts')
      .select(
        'id, local_government_id, signed_date, effective_date, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date, status',
      )
      .eq('id', v.existing_master_id!)
      .is('deleted_at', null)
      .maybeSingle();
    if (masterRes.error || !masterRes.data) {
      return { error: '선택한 메인 계약을 찾을 수 없습니다.' };
    }
    if (masterRes.data.local_government_id !== v.local_government_id) {
      return { error: '선택한 메인 계약이 같은 지자체가 아닙니다.' };
    }
    if (masterRes.data.status === 'terminated') {
      return { error: '종료된 메인 계약에는 부속을 추가할 수 없습니다.' };
    }
    mainId = masterRes.data.id;
    datesSource = {
      signed_date: masterRes.data.signed_date,
      effective_date: masterRes.data.effective_date,
      expiry_date: masterRes.data.expiry_date,
      extended_expiry_date: masterRes.data.extended_expiry_date,
      auto_renewal: masterRes.data.auto_renewal,
      auto_renewal_period_months: masterRes.data.auto_renewal_period_months,
      auto_renewal_end_date: masterRes.data.auto_renewal_end_date,
    };
  }

  const created: BatchCreatedItem[] = [];
  if (v.include_main && mainId) {
    created.push({ id: mainId, contract_type: 'parking_enforcement' });
  }

  // 부속들 INSERT
  for (const stype of v.supplements) {
    const ins = await supabase
      .from('contracts')
      .insert({
        local_government_id: v.local_government_id,
        contracting_party: v.contracting_party,
        contract_type: stype,
        master_contract_id: mainId,
        status: 'in_progress',
        signed_date: datesSource.signed_date,
        effective_date: datesSource.effective_date,
        expiry_date: datesSource.expiry_date,
        extended_expiry_date: datesSource.extended_expiry_date,
        memo: v.memo,
        auto_renewal: datesSource.auto_renewal,
        auto_renewal_period_months: datesSource.auto_renewal_period_months,
        auto_renewal_end_date: datesSource.auto_renewal_end_date,
        created_by: me.id,
        updated_by: me.id,
      })
      .select('id')
      .single();
    if (ins.error || !ins.data) {
      return {
        error: `${stype} 등록 실패: ${ins.error?.message ?? '알 수 없음'}. 먼저 생성된 계약: ${created
          .map((c) => c.contract_type)
          .join(', ')}`,
      };
    }
    created.push({ id: ins.data.id, contract_type: stype });
    await recordCreateSideEffects(supabase, me.id, ins.data.id, {
      local_government_id: v.local_government_id,
      contracting_party: v.contracting_party,
      contract_type: stype,
      master_contract_id: mainId,
      signed_date: datesSource.signed_date,
      effective_date: datesSource.effective_date,
      expiry_date: datesSource.expiry_date,
      extended_expiry_date: datesSource.extended_expiry_date,
      auto_renewal: datesSource.auto_renewal,
      auto_renewal_period_months: datesSource.auto_renewal_period_months,
      auto_renewal_end_date: datesSource.auto_renewal_end_date,
    });
  }

  return { created };
}

async function recordCreateSideEffects(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  contractId: string,
  payload: Record<string, unknown>,
) {
  const { error: histErr } = await supabase.from('contract_status_history').insert({
    contract_id: contractId,
    from_status: null,
    to_status: 'in_progress',
    transition_type: 'create',
    trigger_event: 'contract_create',
    changed_by: userId,
  });
  if (histErr) console.error('[batch] status_history insert failed:', contractId, histErr);

  if (payload.extended_expiry_date && payload.expiry_date) {
    const { error: extErr } = await supabase.from('contract_extensions').insert({
      contract_id: contractId,
      previous_expiry_date: payload.expiry_date as string,
      new_expiry_date: payload.extended_expiry_date as string,
      reason: '초기 등록 시 입력된 연장 정보',
      extended_by: userId,
    });
    if (extErr) console.error('[batch] contract_extensions insert failed:', contractId, extErr);
  }

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: userId,
    event_type: 'contract_create',
    target_type: 'contract',
    target_id: contractId,
    after_value: { ...payload, status: 'in_progress' },
  });
  if (logErr) console.error('[batch] activity_logs insert failed:', contractId, logErr);
}
