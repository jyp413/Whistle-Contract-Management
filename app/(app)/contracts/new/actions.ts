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

// mou(유지보수) 부속은 메인과 다른 일자·자동연장·계약금액을 보유 — 자체 필드 동반.
// personal_info_outsourcing / other 부속은 메인 일자를 그대로 상속 — type 만 보냄.
const MouSupplementSchema = z.object({
  type: z.literal('mou'),
  signed_date: z.string().nullable(),
  effective_date: z.string().nullable(),
  expiry_date: z.string().nullable(),
  extended_expiry_date: z.string().nullable(),
  auto_renewal: z.boolean(),
  auto_renewal_period_months: z.number().int().positive().nullable(),
  auto_renewal_end_date: z.string().nullable(),
  amount_krw: z.number().int().nonnegative().nullable(),
});
const PlainSupplementSchema = z.object({
  type: z.enum(['personal_info_outsourcing', 'other']),
});
const SupplementInputSchema = z.discriminatedUnion('type', [
  MouSupplementSchema,
  PlainSupplementSchema,
]);
type MouSupplementInput = z.infer<typeof MouSupplementSchema>;
type SupplementInput = z.infer<typeof SupplementInputSchema>;

const BatchSchema = z.object({
  local_government_id: z.string().uuid(),
  contracting_party: z.enum(['monoplatform', 'imcity']),
  include_main: z.boolean(),
  existing_master_id: z.string().uuid().nullable(),
  supplements: z.array(SupplementInputSchema),
  signed_date: z.string().nullable(),
  effective_date: z.string().nullable(),
  expiry_date: z.string().nullable(),
  extended_expiry_date: z.string().nullable(),
  memo: z.string().nullable(),
  auto_renewal: z.boolean(),
  auto_renewal_period_months: z.number().int().positive().nullable(),
  auto_renewal_end_date: z.string().nullable(),
  // 중복 경고 모달에서 사용자가 "그대로 등록" 클릭 시 true 로 재호출
  force: z.boolean().optional().default(false),
});

export type BatchCreatedItem = {
  id: string;
  contract_type:
    | 'parking_enforcement'
    | 'personal_info_outsourcing'
    | 'mou'
    | 'other';
};

export type DuplicateHit = {
  id: string;
  lg_name: string;
  contract_type:
    | 'parking_enforcement'
    | 'personal_info_outsourcing'
    | 'mou'
    | 'other';
  contracting_party: 'monoplatform' | 'imcity';
  status: string;
  signed_date: string | null;
  is_main: boolean;
};

export async function createContractBatch(input: unknown): Promise<
  | { error: string; created?: undefined; duplicates?: undefined }
  | { duplicates: DuplicateHit[]; created?: undefined; error?: undefined }
  | { error?: undefined; duplicates?: undefined; created: BatchCreatedItem[] }
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

  const supabaseEarly = await createClient();

  // 중복 사전 검사 (force=false 일 때만) — 사용자가 확인 모달에서 "그대로 등록"을 누르면 force=true 로 재호출.
  if (!v.force) {
    const dupes = await findDuplicates(supabaseEarly, {
      local_government_id: v.local_government_id,
      contracting_party: v.contracting_party,
      include_main: v.include_main,
      existing_master_id: v.existing_master_id,
      // 부속 중복 검사는 type 기준이므로 객체 → enum string 배열로 변환
      supplements: v.supplements.map((s) => s.type),
    });
    if (dupes.length > 0) {
      return { duplicates: dupes };
    }
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
  const supabase = supabaseEarly;

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

  // 부속들 INSERT — mou는 자체 일자·금액, 나머지는 메인 일자 상속
  const today = new Date().toISOString().slice(0, 10);
  for (const sup of v.supplements) {
    const stype = sup.type;
    const isMou = sup.type === 'mou';
    const mouSup = isMou ? (sup as MouSupplementInput) : null;

    // mou 부속은 자체 일자 가드 — 메인 가드와 동일 로직
    if (mouSup) {
      if (
        mouSup.expiry_date &&
        mouSup.effective_date &&
        mouSup.expiry_date < mouSup.effective_date
      ) {
        return { error: '유지보수: 계약만료일은 시작일 이후여야 합니다.' };
      }
      if (mouSup.auto_renewal) {
        if (!mouSup.auto_renewal_period_months || mouSup.auto_renewal_period_months < 1) {
          return { error: '유지보수: 자동연장 주기(개월)를 1 이상으로 입력하세요.' };
        }
        if (
          mouSup.auto_renewal_end_date &&
          mouSup.expiry_date &&
          mouSup.auto_renewal_end_date < mouSup.expiry_date
        ) {
          return { error: '유지보수: 자동연장 종료일은 계약만료일 이후여야 합니다.' };
        }
      }
      if (mouSup.expiry_date && mouSup.expiry_date < today && !mouSup.auto_renewal) {
        if (!mouSup.extended_expiry_date) {
          return {
            error:
              '유지보수: 만료일이 이미 지난 계약입니다. 연장 후 만료일을 함께 입력하거나 자동연장을 설정하세요.',
          };
        }
        if (mouSup.extended_expiry_date <= mouSup.expiry_date) {
          return { error: '유지보수: 연장 후 만료일은 기존 만료일 이후여야 합니다.' };
        }
        if (mouSup.extended_expiry_date < today) {
          return { error: '유지보수: 연장 후 만료일도 이미 지났습니다.' };
        }
      }
      if (
        mouSup.extended_expiry_date &&
        mouSup.expiry_date &&
        mouSup.extended_expiry_date <= mouSup.expiry_date
      ) {
        return { error: '유지보수: 연장 후 만료일은 기존 만료일 이후여야 합니다.' };
      }
    }

    const supDates = mouSup
      ? {
          signed_date: mouSup.signed_date,
          effective_date: mouSup.effective_date,
          expiry_date: mouSup.expiry_date,
          extended_expiry_date: mouSup.extended_expiry_date,
          auto_renewal: mouSup.auto_renewal,
          auto_renewal_period_months: mouSup.auto_renewal
            ? mouSup.auto_renewal_period_months
            : null,
          auto_renewal_end_date: mouSup.auto_renewal ? mouSup.auto_renewal_end_date : null,
        }
      : datesSource;
    const supAmount = mouSup ? mouSup.amount_krw : null;

    // mou 부속은 도메인상 항상 모노플랫폼 직접 — 폼의 주체값 무시하고 강제
    const supParty: 'monoplatform' | 'imcity' = isMou ? 'monoplatform' : v.contracting_party;

    const ins = await supabase
      .from('contracts')
      .insert({
        local_government_id: v.local_government_id,
        contracting_party: supParty,
        contract_type: stype,
        master_contract_id: mainId,
        status: 'in_progress',
        signed_date: supDates.signed_date,
        effective_date: supDates.effective_date,
        expiry_date: supDates.expiry_date,
        extended_expiry_date: supDates.extended_expiry_date,
        memo: v.memo,
        auto_renewal: supDates.auto_renewal,
        auto_renewal_period_months: supDates.auto_renewal_period_months,
        auto_renewal_end_date: supDates.auto_renewal_end_date,
        amount_krw: supAmount,
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
      contracting_party: supParty,
      contract_type: stype,
      master_contract_id: mainId,
      signed_date: supDates.signed_date,
      effective_date: supDates.effective_date,
      expiry_date: supDates.expiry_date,
      extended_expiry_date: supDates.extended_expiry_date,
      auto_renewal: supDates.auto_renewal,
      auto_renewal_period_months: supDates.auto_renewal_period_months,
      auto_renewal_end_date: supDates.auto_renewal_end_date,
    });
  }

  return { created };
}

/**
 * 살아있는(=terminated가 아닌, soft-delete 안 된) 동종 계약을 찾는다.
 * - 메인 등록 (`include_main=true`): 같은 LG + 같은 주체 + parking_enforcement + master_contract_id IS NULL
 * - 부속 등록 (existing_master_id 지정): 같은 master + 같은 contract_type
 *   (include_main=true 인 경우는 새 메인이라 부속 중복 발생 불가 — 검사 생략)
 *
 * 사용자가 confirm 모달에서 "그대로 등록"을 누르면 액션이 force=true 로 재호출되어 이 검사를 건너뛴다.
 */
async function findDuplicates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  v: {
    local_government_id: string;
    contracting_party: 'monoplatform' | 'imcity';
    include_main: boolean;
    existing_master_id: string | null;
    supplements: readonly SupplementType[];
  },
): Promise<DuplicateHit[]> {
  const hits: DuplicateHit[] = [];

  // 1) 메인 중복
  if (v.include_main) {
    const { data: mainHits } = await supabase
      .from('contracts')
      .select(
        'id, status, signed_date, contract_type, contracting_party, local_governments(full_name)',
      )
      .eq('local_government_id', v.local_government_id)
      .eq('contracting_party', v.contracting_party)
      .eq('contract_type', 'parking_enforcement')
      .is('master_contract_id', null)
      .neq('status', 'terminated')
      .is('deleted_at', null);
    for (const r of mainHits ?? []) {
      hits.push({
        id: r.id,
        lg_name: r.local_governments?.full_name ?? '-',
        contract_type: r.contract_type,
        contracting_party: r.contracting_party,
        status: r.status,
        signed_date: r.signed_date,
        is_main: true,
      });
    }
  }

  // 2) 부속 중복 — 기존 메인 아래에 같은 type 부속이 이미 살아있는 경우
  if (!v.include_main && v.existing_master_id && v.supplements.length > 0) {
    const { data: supHits } = await supabase
      .from('contracts')
      .select(
        'id, status, signed_date, contract_type, contracting_party, master_contract_id, local_governments(full_name)',
      )
      .eq('master_contract_id', v.existing_master_id)
      .in('contract_type', v.supplements as unknown as SupplementType[])
      .neq('status', 'terminated')
      .is('deleted_at', null);
    for (const r of supHits ?? []) {
      hits.push({
        id: r.id,
        lg_name: r.local_governments?.full_name ?? '-',
        contract_type: r.contract_type,
        contracting_party: r.contracting_party,
        status: r.status,
        signed_date: r.signed_date,
        is_main: false,
      });
    }
  }

  return hits;
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
