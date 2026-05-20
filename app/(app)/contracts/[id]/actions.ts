'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireMaster, requireWriter } from '@/lib/auth';
import { effectiveExpiry } from '@/lib/utils';

type Result<T = Record<string, never>> =
  | ({ error: string } & Partial<T>)
  | ({ error?: undefined } & T);

/**
 * Storage 업로드 직후 호출. 다음 version_no, is_latest=TRUE 처리.
 * - 클라이언트가 보낸 storagePath는 반드시 `${contractId}/` 로 시작해야 한다 (다른 계약 prefix 침입 방지).
 * - 객체가 실제 존재하는지 Storage list 로 확인 (위변조 등록 방지).
 */
export async function registerUploadedFile(input: {
  contractId: string;
  storagePath: string;
  originalFilename: string;
  fileSizeBytes: number;
  checksumSha256: string;
}): Promise<Result<{ fileId: string; versionNo: number }>> {
  const me = await requireWriter();

  const prefix = `${input.contractId}/`;
  if (!input.storagePath.startsWith(prefix)) {
    return { error: '파일 경로가 계약 ID와 일치하지 않습니다.' };
  }
  if (input.storagePath.includes('..') || input.storagePath.includes('//')) {
    return { error: '잘못된 파일 경로입니다.' };
  }
  if (input.fileSizeBytes <= 0 || input.fileSizeBytes > 50 * 1024 * 1024) {
    return { error: '파일 크기가 허용 범위를 벗어났습니다.' };
  }

  const supabase = await createClient();

  // Storage에 객체가 실제 존재하는지 검증
  const objectName = input.storagePath.slice(prefix.length);
  const { data: listed, error: listErr } = await supabase.storage
    .from('contract-files')
    .list(input.contractId, { search: objectName, limit: 1 });
  if (listErr) return { error: `Storage 확인 실패: ${listErr.message}` };
  if (!listed?.some((o) => o.name === objectName)) {
    return { error: 'Storage 객체가 존재하지 않습니다. 업로드를 다시 시도하세요.' };
  }

  const latestRes = await supabase
    .from('contract_files')
    .select('version_no')
    .eq('contract_id', input.contractId)
    .order('version_no', { ascending: false })
    .limit(1);

  const nextVersion = (latestRes.data?.[0]?.version_no ?? 0) + 1;

  const { error: demoteErr } = await supabase
    .from('contract_files')
    .update({ is_latest: false })
    .eq('contract_id', input.contractId)
    .eq('is_latest', true);
  if (demoteErr) {
    return { error: `이전 버전 해제 실패: ${demoteErr.message}` };
  }

  const { data: inserted, error } = await supabase
    .from('contract_files')
    .insert({
      contract_id: input.contractId,
      storage_path: input.storagePath,
      original_filename: input.originalFilename,
      file_size_bytes: input.fileSizeBytes,
      mime_type: 'application/pdf',
      checksum_sha256: input.checksumSha256,
      version_no: nextVersion,
      is_latest: true,
      uploaded_by: me.id,
    })
    .select('id')
    .single();

  if (error || !inserted) return { error: error?.message ?? '파일 등록 실패' };

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'file_upload',
    target_type: 'file',
    target_id: inserted.id,
    after_value: {
      contract_id: input.contractId,
      filename: input.originalFilename,
      version: nextVersion,
    },
  });
  if (logErr) console.error('[registerUploadedFile] activity_logs insert failed:', logErr);

  revalidatePath(`/contracts/${input.contractId}`);
  return { fileId: inserted.id, versionNo: nextVersion };
}

/**
 * "계약완료로 변경하시겠습니까?" 승인 → in_progress / updating → completed
 */
export async function confirmCompletion(input: {
  contractId: string;
  expectedVersion: number;
  /** 겹침 경고 모달에서 "그래도 완료" 클릭 시 true 로 재호출 */
  force?: boolean;
}): Promise<
  | { ok: true; error?: undefined; overlapWarning?: undefined }
  | { error: string; ok?: undefined; overlapWarning?: undefined }
  | {
      overlapWarning: { parentExpiry: string };
      ok?: undefined;
      error?: undefined;
    }
> {
  const me = await requireWriter();
  const supabase = await createClient();

  const { data: cur, error: e1 } = await supabase
    .from('contracts')
    .select('id, status, version, parent_contract_id')
    .eq('id', input.contractId)
    .is('deleted_at', null)
    .single();

  if (e1 || !cur) return { error: '계약을 찾을 수 없습니다.' };
  if (cur.status !== 'in_progress' && cur.status !== 'updating') {
    return { error: `현재 상태(${cur.status})에서는 계약완료로 전환할 수 없습니다.` };
  }
  if (cur.version !== input.expectedVersion) {
    return { error: '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.' };
  }

  // 겹침 가드 — 갱신 계약(parent_contract_id 보유)을 완료 처리할 때, 부모(원계약)가
  // 아직 'completed' + 만료 전이면 같은 계약 chain에 활성 계약 2건이 겹친다.
  // force=false 면 경고 반환 → 클라이언트가 동의 후 force=true 로 재호출.
  if (!input.force && cur.parent_contract_id) {
    const { data: parent } = await supabase
      .from('contracts')
      .select(
        'id, status, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date',
      )
      .eq('id', cur.parent_contract_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (parent && parent.status === 'completed') {
      const parentExpiry = effectiveExpiry(parent);
      const today = new Date().toISOString().slice(0, 10);
      if (parentExpiry && parentExpiry >= today) {
        return { overlapWarning: { parentExpiry } };
      }
    }
  }

  const fromStatus = cur.status;
  const { error: e2, count } = await supabase
    .from('contracts')
    .update(
      {
        status: 'completed',
        version: cur.version + 1,
        updated_by: me.id,
      },
      { count: 'exact' },
    )
    .eq('id', input.contractId)
    .eq('version', cur.version)
    .is('deleted_at', null);

  if (e2) return { error: e2.message };
  if (!count) {
    return { error: '동시 수정 충돌이 발생했습니다. 새로고침 후 다시 시도하세요.' };
  }

  const { error: histErr } = await supabase.from('contract_status_history').insert({
    contract_id: input.contractId,
    from_status: fromStatus,
    to_status: 'completed',
    transition_type: 'file_upload_confirm',
    trigger_event: '확인 팝업 승인',
    changed_by: me.id,
  });
  if (histErr) console.error('[confirmCompletion] status_history insert failed:', histErr);

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'status_change',
    target_type: 'contract',
    target_id: input.contractId,
    before_value: { status: fromStatus },
    after_value: { status: 'completed' },
  });
  if (logErr) console.error('[confirmCompletion] activity_logs insert failed:', logErr);

  revalidatePath(`/contracts/${input.contractId}`);
  return { ok: true };
}

/**
 * 계약기간 연장 (Extend). 상태는 그대로 completed, 만료일만 갱신.
 * - new_expiry_date > 현재 실효 만료일
 * - contracts.extended_expiry_date 갱신, version+1
 * - contract_extensions 이력 + 상태 이력(transition_type='extend') + activity_logs
 */
export async function extendContract(input: {
  contractId: string;
  expectedVersion: number;
  newExpiryDate: string;
  reason?: string | null;
}): Promise<Result<{ ok: true }>> {
  const me = await requireWriter();
  const supabase = await createClient();

  const { data: cur, error: e1 } = await supabase
    .from('contracts')
    .select(
      'id, status, version, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date',
    )
    .eq('id', input.contractId)
    .is('deleted_at', null)
    .single();

  if (e1 || !cur) return { error: '계약을 찾을 수 없습니다.' };
  if (cur.status !== 'completed') {
    return { error: '계약완료 상태에서만 연장할 수 있습니다.' };
  }
  if (cur.version !== input.expectedVersion) {
    return { error: '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.' };
  }

  // 자동연장 계약은 effectiveExpiry()가 expiry_date를 today 이후로 roll forward 하므로
  // 베이스라인으로 raw expiry_date를 쓰면 사실상 단축되는 입력도 통과한다 — SSOT 함수 경유 필수.
  const previousEffective = effectiveExpiry(cur);
  if (!previousEffective) {
    return { error: '기존 만료일이 설정되어 있지 않아 연장할 수 없습니다.' };
  }
  if (input.newExpiryDate <= previousEffective) {
    return { error: '새 만료일은 기존 실효 만료일보다 이후여야 합니다.' };
  }

  // contracts.extended_expiry_date > expiry_date 제약 — 항상 만족 (newExpiryDate > previousEffective >= expiry_date)
  const { error: e2, count } = await supabase
    .from('contracts')
    .update(
      {
        extended_expiry_date: input.newExpiryDate,
        version: cur.version + 1,
        updated_by: me.id,
      },
      { count: 'exact' },
    )
    .eq('id', input.contractId)
    .eq('version', cur.version)
    .is('deleted_at', null);

  if (e2) return { error: e2.message };
  if (!count) {
    return { error: '동시 수정 충돌. 새로고침 후 다시 시도하세요.' };
  }

  const { error: extErr } = await supabase.from('contract_extensions').insert({
    contract_id: input.contractId,
    previous_expiry_date: previousEffective,
    new_expiry_date: input.newExpiryDate,
    reason: input.reason || null,
    extended_by: me.id,
  });
  if (extErr) console.error('[extendContract] contract_extensions insert failed:', extErr);

  const { error: histErr } = await supabase.from('contract_status_history').insert({
    contract_id: input.contractId,
    from_status: 'completed',
    to_status: 'completed',
    transition_type: 'extend',
    reason: input.reason || null,
    trigger_event: 'extend_button',
    changed_by: me.id,
  });
  if (histErr) console.error('[extendContract] status_history insert failed:', histErr);

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'extension',
    target_type: 'contract',
    target_id: input.contractId,
    before_value: { effective_expiry: previousEffective },
    after_value: {
      effective_expiry: input.newExpiryDate,
      reason: input.reason || null,
    },
  });
  if (logErr) console.error('[extendContract] activity_logs insert failed:', logErr);

  revalidatePath(`/contracts/${input.contractId}`);
  return { ok: true };
}

/**
 * 종료 처리 (terminate). 어떤 상태에서든 종료로 변경 + 사유 기록.
 */
export async function terminateContract(input: {
  contractId: string;
  expectedVersion: number;
  reason: string;
}): Promise<Result<{ ok: true }>> {
  const me = await requireWriter();
  const reason = input.reason.trim();
  if (!reason) return { error: '종료 사유는 필수입니다.' };

  const supabase = await createClient();
  const { data: cur, error: e1 } = await supabase
    .from('contracts')
    .select('id, status, version')
    .eq('id', input.contractId)
    .is('deleted_at', null)
    .single();

  if (e1 || !cur) return { error: '계약을 찾을 수 없습니다.' };
  if (cur.status === 'terminated') return { error: '이미 종료된 계약입니다.' };
  if (cur.version !== input.expectedVersion) {
    return { error: '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.' };
  }

  const fromStatus = cur.status;
  const { error: e2, count } = await supabase
    .from('contracts')
    .update(
      {
        status: 'terminated',
        termination_reason: reason,
        version: cur.version + 1,
        updated_by: me.id,
      },
      { count: 'exact' },
    )
    .eq('id', input.contractId)
    .eq('version', cur.version)
    .is('deleted_at', null);

  if (e2) return { error: e2.message };
  if (!count) {
    return { error: '동시 수정 충돌이 발생했습니다. 새로고침 후 다시 시도하세요.' };
  }

  const { error: histErr } = await supabase.from('contract_status_history').insert({
    contract_id: input.contractId,
    from_status: fromStatus,
    to_status: 'terminated',
    transition_type: 'terminate',
    reason,
    changed_by: me.id,
  });
  if (histErr) console.error('[terminateContract] status_history insert failed:', histErr);

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'status_change',
    target_type: 'contract',
    target_id: input.contractId,
    before_value: { status: fromStatus },
    after_value: { status: 'terminated', reason },
  });
  if (logErr) console.error('[terminateContract] activity_logs insert failed:', logErr);

  revalidatePath(`/contracts/${input.contractId}`);
  return { ok: true };
}

/**
 * 갱신 착수 (renew_start).
 * - 부모: completed 유지 (만료일까지)
 * - 신규 계약 행: parent_contract_id = parent.id, status = 'updating'
 * - effective_date 후보 = 부모의 실효 만료일 + 1일
 */
export async function startRenewal(input: {
  parentContractId: string;
  expectedVersion: number;
}): Promise<Result<{ ok: true; newId: string }>> {
  const me = await requireWriter();
  const supabase = await createClient();

  const { data: parent, error: e1 } = await supabase
    .from('contracts')
    .select(
      'id, status, version, local_government_id, contract_type, contracting_party, master_contract_id, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date, amount_krw, memo',
    )
    .eq('id', input.parentContractId)
    .is('deleted_at', null)
    .single();

  if (e1 || !parent) return { error: '부모 계약을 찾을 수 없습니다.' };
  if (parent.status !== 'completed') {
    return { error: '계약완료 상태에서만 갱신을 착수할 수 있습니다.' };
  }
  if (parent.version !== input.expectedVersion) {
    return { error: '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.' };
  }

  // 자동연장 계약은 expiry_date가 옛 날짜일 수 있으므로 effectiveExpiry()로 실효 만료일을 구한다.
  const parentExpiry = effectiveExpiry(parent);
  let nextStart: string | null = null;
  if (parentExpiry) {
    const d = new Date(parentExpiry);
    d.setDate(d.getDate() + 1);
    nextStart = d.toISOString().slice(0, 10);
  }

  // 부모의 type/party/master_contract_id를 새 row에도 상속 (chain 정합성).
  // mou는 amount_krw + memo + auto_renewal 정보도 prefill — 사용자가 새 값 입력 시까지 작년 값 유지.
  const isMou = parent.contract_type === 'mou';
  const { data: child, error: e2 } = await supabase
    .from('contracts')
    .insert({
      local_government_id: parent.local_government_id,
      parent_contract_id: parent.id,
      contract_type: parent.contract_type,
      contracting_party: parent.contracting_party,
      master_contract_id: parent.master_contract_id,
      status: 'updating',
      effective_date: nextStart,
      auto_renewal: parent.auto_renewal,
      auto_renewal_period_months: parent.auto_renewal ? parent.auto_renewal_period_months : null,
      auto_renewal_end_date: parent.auto_renewal ? parent.auto_renewal_end_date : null,
      amount_krw: isMou ? parent.amount_krw : null,
      memo: parent.memo,
      created_by: me.id,
      updated_by: me.id,
    })
    .select('id')
    .single();

  if (e2 || !child) return { error: e2?.message ?? '갱신 계약 생성 실패' };

  const { error: histErr } = await supabase.from('contract_status_history').insert({
    contract_id: child.id,
    from_status: null,
    to_status: 'updating',
    transition_type: 'renew_start',
    trigger_event: `parent=${parent.id}`,
    changed_by: me.id,
  });
  if (histErr) console.error('[startRenewal] status_history insert failed:', histErr);

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'status_change',
    target_type: 'contract',
    target_id: child.id,
    before_value: null,
    after_value: {
      status: 'updating',
      parent_contract_id: parent.id,
    },
  });
  if (logErr) console.error('[startRenewal] activity_logs insert failed:', logErr);

  revalidatePath(`/contracts/${parent.id}`);
  revalidatePath('/contracts');
  return { ok: true, newId: child.id };
}

/**
 * 계약 soft delete (Master 전용).
 * - deleted_at = NOW() 만 세팅, status 컬럼은 건드리지 않음 (전이 트리거 회피).
 * - 낙관락은 head 버전 비교 + count: 'exact' 로 영향 행 수 검사.
 *   .select() 후 RLS 가 deleted_at IS NULL 행만 보이므로 RETURNING 으로 검증 시 실패.
 * - history / extensions / activity_logs 행은 그대로 보존 → "이력 불변성" 준수.
 */
export async function deleteContract(input: {
  contractId: string;
  expectedVersion: number;
}): Promise<Result<{ ok: true }>> {
  const me = await requireMaster();
  const supabase = await createClient();

  const { data: cur, error: e1 } = await supabase
    .from('contracts')
    .select('id, status, version')
    .eq('id', input.contractId)
    .is('deleted_at', null)
    .single();

  if (e1 || !cur) return { error: '계약을 찾을 수 없습니다.' };
  if (cur.version !== input.expectedVersion) {
    return {
      error: `다른 사용자가 먼저 수정했습니다 (서버 버전 v${cur.version}, 화면 v${input.expectedVersion}). 새로고침 후 다시 시도하세요.`,
    };
  }

  const deletedAt = new Date().toISOString();
  const { error: e2, count } = await supabase
    .from('contracts')
    .update(
      {
        deleted_at: deletedAt,
        version: cur.version + 1,
        updated_by: me.id,
      },
      { count: 'exact' },
    )
    .eq('id', input.contractId)
    .eq('version', cur.version);

  if (e2) return { error: e2.message };
  if (!count) {
    return { error: '동시 수정 충돌이 발생했습니다. 새로고침 후 다시 시도하세요.' };
  }

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'contract_delete',
    target_type: 'contract',
    target_id: input.contractId,
    before_value: { status: cur.status, deleted_at: null },
    after_value: { deleted_at: deletedAt },
  });
  if (logErr) console.error('[deleteContract] activity_logs insert failed:', logErr);

  revalidatePath('/contracts');
  revalidatePath('/dashboard');
  revalidatePath('/expiring');
  return { ok: true };
}

/**
 * 상태 보정 (correction). RPC 위임.
 */
export async function applyCorrection(input: {
  contractId: string;
  targetHistoryId: string;
  expectedVersion: number;
  reason: string;
}): Promise<Result<{ ok: true }>> {
  await requireWriter();
  const reason = input.reason.trim();
  if (!reason) return { error: '보정 사유는 필수입니다.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('apply_correction', {
    p_contract_id: input.contractId,
    p_target_history_id: input.targetHistoryId,
    p_expected_version: input.expectedVersion,
    p_reason: reason,
  });

  if (error) return { error: error.message };

  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    'error' in data &&
    typeof (data as { error?: unknown }).error === 'string'
  ) {
    return { error: (data as { error: string }).error };
  }

  revalidatePath(`/contracts/${input.contractId}`);
  return { ok: true };
}

/**
 * 메타데이터 자유 수정 (status 외).
 * - 수정 가능: signed_date, effective_date, expiry_date, extended_expiry_date, memo,
 *   contract_type, contracting_party, master_contract_id
 * - 수정 금지: local_government_id, status, parent_contract_id, version, deleted_at
 * - 옵티미스틱 락(version) + activity_logs(before/after) 기록
 */
export async function updateContractMeta(input: {
  contractId: string;
  expectedVersion: number;
  signed_date: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  extended_expiry_date: string | null;
  memo: string | null;
  contract_type: 'parking_enforcement' | 'personal_info_outsourcing' | 'mou' | 'other';
  contracting_party: 'monoplatform' | 'imcity';
  master_contract_id: string | null;
  auto_renewal: boolean;
  auto_renewal_period_months: number | null;
  auto_renewal_end_date: string | null;
  /** 계약금액(KRW). mou일 때만 의미가 있고, 다른 type은 NULL로 강제 클리어. */
  amount_krw: number | null;
}): Promise<Result<{ ok: true }>> {
  const me = await requireWriter();
  const supabase = await createClient();

  const { data: cur, error: e1 } = await supabase
    .from('contracts')
    .select(
      'id, version, signed_date, effective_date, expiry_date, extended_expiry_date, memo, contract_type, contracting_party, master_contract_id, local_government_id, auto_renewal, auto_renewal_period_months, auto_renewal_end_date, amount_krw',
    )
    .eq('id', input.contractId)
    .is('deleted_at', null)
    .single();

  if (e1 || !cur) return { error: '계약을 찾을 수 없습니다.' };
  if (cur.version !== input.expectedVersion) {
    return { error: '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.' };
  }

  if (input.expiry_date && input.effective_date && input.expiry_date < input.effective_date) {
    return { error: '계약만료일은 시작일 이후여야 합니다.' };
  }
  const today = new Date().toISOString().slice(0, 10);

  if (input.auto_renewal) {
    if (!input.auto_renewal_period_months || input.auto_renewal_period_months < 1) {
      return { error: '자동연장 주기(개월)를 1 이상으로 입력하세요.' };
    }
    if (
      input.auto_renewal_end_date &&
      input.expiry_date &&
      input.auto_renewal_end_date < input.expiry_date
    ) {
      return { error: '자동연장 종료일은 계약만료일 이후여야 합니다.' };
    }
  }

  if (input.expiry_date && input.expiry_date < today && !input.auto_renewal) {
    if (!input.extended_expiry_date) {
      return { error: '만료일이 이미 지났습니다. 연장 후 만료일을 함께 입력하거나 자동연장을 설정하세요.' };
    }
    if (input.extended_expiry_date <= input.expiry_date) {
      return { error: '연장 후 만료일은 기존 만료일 이후여야 합니다.' };
    }
    if (input.extended_expiry_date < today) {
      return { error: '연장 후 만료일도 이미 지났습니다. 현재 유효한 만료일을 입력하세요.' };
    }
  }
  if (input.extended_expiry_date && input.expiry_date && input.extended_expiry_date <= input.expiry_date) {
    return { error: '연장 후 만료일은 기존 만료일 이후여야 합니다.' };
  }

  if (input.contract_type === 'parking_enforcement') {
    if (input.master_contract_id !== null) {
      return { error: '주차단속 위수탁(메인)은 메인 계약 연결을 가질 수 없습니다.' };
    }
  } else {
    if (!input.master_contract_id) {
      return { error: '부속 계약은 같은 지자체의 메인 계약을 선택해야 합니다.' };
    }
  }

  // 메인 → 부속 전환 시: 이 계약을 메인으로 가리키는 부속들이 있으면 거부 (고아 방지)
  const becomingSupplement =
    cur.master_contract_id === null && input.master_contract_id !== null;
  if (becomingSupplement) {
    const { count: depCount } = await supabase
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .eq('master_contract_id', input.contractId)
      .is('deleted_at', null);
    if ((depCount ?? 0) > 0) {
      return {
        error: `이 계약을 메인으로 가리키는 부속 계약이 ${depCount}건 있어 부속으로 전환할 수 없습니다. 먼저 해당 부속들의 메인을 다른 계약으로 변경하거나 종료하세요.`,
      };
    }
  }

  // 계약금액: mou만 보존, 그 외 type은 NULL로 강제 클리어
  // (type 변경으로 mou에서 빠져나갈 때 잔존 값 방지)
  const finalAmountKrw = input.contract_type === 'mou' ? input.amount_krw : null;
  if (
    finalAmountKrw != null &&
    (!Number.isInteger(finalAmountKrw) || finalAmountKrw < 0)
  ) {
    return { error: '계약금액은 0 이상의 정수여야 합니다.' };
  }
  // 주체: mou는 도메인상 항상 monoplatform — DB CHECK도 강제. 폼이 imcity 보내도 덮어쓰기.
  const finalParty: 'monoplatform' | 'imcity' =
    input.contract_type === 'mou' ? 'monoplatform' : input.contracting_party;
  // mou는 연장 개념 없음 (invariant #9) — extended_expiry_date / auto_renewal* 모두 null/false 강제.
  // type 변경으로 mou에서 빠져나갈 때는 원래 값 그대로.
  const isMouUpdate = input.contract_type === 'mou';
  const finalExtendedExpiry = isMouUpdate ? null : input.extended_expiry_date;
  const finalAutoRenewal = isMouUpdate ? false : input.auto_renewal;
  const finalAutoRenewalPeriod = isMouUpdate
    ? null
    : input.auto_renewal
      ? input.auto_renewal_period_months
      : null;
  const finalAutoRenewalEnd = isMouUpdate
    ? null
    : input.auto_renewal
      ? input.auto_renewal_end_date
      : null;

  const { error: e2, count } = await supabase
    .from('contracts')
    .update(
      {
        signed_date: input.signed_date,
        effective_date: input.effective_date,
        expiry_date: input.expiry_date,
        extended_expiry_date: finalExtendedExpiry,
        memo: input.memo,
        contract_type: input.contract_type,
        contracting_party: finalParty,
        master_contract_id: input.master_contract_id,
        auto_renewal: finalAutoRenewal,
        auto_renewal_period_months: finalAutoRenewalPeriod,
        auto_renewal_end_date: finalAutoRenewalEnd,
        amount_krw: finalAmountKrw,
        version: cur.version + 1,
        updated_by: me.id,
      },
      { count: 'exact' },
    )
    .eq('id', input.contractId)
    .eq('version', cur.version)
    .is('deleted_at', null);

  if (e2) return { error: e2.message };
  if (!count) return { error: '동시 수정 충돌. 새로고침 후 다시 시도하세요.' };

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'meta_update',
    target_type: 'contract',
    target_id: input.contractId,
    before_value: {
      signed_date: cur.signed_date,
      effective_date: cur.effective_date,
      expiry_date: cur.expiry_date,
      extended_expiry_date: cur.extended_expiry_date,
      memo: cur.memo,
      contract_type: cur.contract_type,
      contracting_party: cur.contracting_party,
      master_contract_id: cur.master_contract_id,
      auto_renewal: cur.auto_renewal,
      auto_renewal_period_months: cur.auto_renewal_period_months,
      auto_renewal_end_date: cur.auto_renewal_end_date,
      amount_krw: cur.amount_krw,
    },
    after_value: {
      signed_date: input.signed_date,
      effective_date: input.effective_date,
      expiry_date: input.expiry_date,
      extended_expiry_date: finalExtendedExpiry,
      memo: input.memo,
      contract_type: input.contract_type,
      contracting_party: finalParty,
      master_contract_id: input.master_contract_id,
      auto_renewal: finalAutoRenewal,
      auto_renewal_period_months: finalAutoRenewalPeriod,
      auto_renewal_end_date: finalAutoRenewalEnd,
      amount_krw: finalAmountKrw,
    },
  });
  if (logErr) console.error('[updateContractMeta] activity_logs insert failed:', logErr);

  revalidatePath(`/contracts/${input.contractId}`);
  revalidatePath('/contracts');
  return { ok: true };
}

/**
 * 지자체 담당자 정보 수정 (department / name / phone / email).
 * 같은 LG의 모든 계약이 동일 담당자를 공유.
 * 권한: writer+ (master / accounting).
 * activity_logs target_type='local_government', event_type='contract_update' (재사용).
 *
 * IDOR 방지: 클라이언트가 보낸 localGovernmentId가 contract.local_government_id와
 * 일치하는지 서버에서 검증한 뒤에만 update 수행.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updateLGContact(input: {
  contractId: string;
  localGovernmentId: string;
  contact_department: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
}): Promise<Result<{ ok: true }>> {
  const me = await requireWriter();
  const supabase = await createClient();

  if (input.contact_email && !EMAIL_RE.test(input.contact_email)) {
    return { error: '이메일 형식이 올바르지 않습니다.' };
  }
  if (input.contact_phone && input.contact_phone.length > 50) {
    return { error: '전화번호가 너무 깁니다.' };
  }

  // contract 로드 후 LG 소유 검증 (IDOR 방지)
  const { data: contract, error: cErr } = await supabase
    .from('contracts')
    .select('id, local_government_id')
    .eq('id', input.contractId)
    .is('deleted_at', null)
    .single();
  if (cErr || !contract) return { error: '계약을 찾을 수 없습니다.' };
  if (contract.local_government_id !== input.localGovernmentId) {
    return { error: '계약과 지자체 정보가 일치하지 않습니다.' };
  }

  const { data: before } = await supabase
    .from('local_governments')
    .select('contact_department, contact_name, contact_phone, contact_email')
    .eq('id', input.localGovernmentId)
    .is('deleted_at', null)
    .single();

  const { error } = await supabase
    .from('local_governments')
    .update({
      contact_department: input.contact_department,
      contact_name: input.contact_name,
      contact_phone: input.contact_phone,
      contact_email: input.contact_email,
    })
    .eq('id', input.localGovernmentId)
    .is('deleted_at', null);

  if (error) return { error: error.message };

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'contract_update',
    target_type: 'local_government',
    target_id: input.localGovernmentId,
    before_value: before ?? {},
    after_value: {
      contact_department: input.contact_department,
      contact_name: input.contact_name,
      contact_phone: input.contact_phone,
      contact_email: input.contact_email,
    },
  });
  if (logErr) console.error('[updateLGContact] activity_logs insert failed:', logErr);

  revalidatePath(`/contracts/${input.contractId}`);
  return { ok: true };
}

/**
 * 파일 삭제: SECURITY DEFINER RPC `soft_delete_contract_file` 위임 (RLS 우회) + Storage hard remove.
 * - RPC가 권한 검증, deleted_at/is_latest 갱신, 다음 latest 자동 승격까지 처리
 * - 액션은 Storage 객체 제거 + activity_logs 기록 담당
 * - 직접 .update() 사용 시 contract_files의 SELECT 정책(deleted_at IS NULL)이 post-update 검사에서
 *   새 행을 막아 "new row violates row-level security policy" 에러 발생 → RPC 패턴 필요 (CLAUDE.md §RLS-filtered RETURNING trap)
 */
export async function deleteContractFile(input: {
  fileId: string;
  contractId: string;
}): Promise<Result<{ ok: true }>> {
  const me = await requireWriter();
  const supabase = await createClient();

  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    'soft_delete_contract_file',
    {
      p_file_id: input.fileId,
      p_contract_id: input.contractId,
    },
  );

  if (rpcErr) return { error: rpcErr.message };

  if (
    rpcData &&
    typeof rpcData === 'object' &&
    !Array.isArray(rpcData) &&
    'error' in rpcData &&
    typeof (rpcData as { error?: unknown }).error === 'string'
  ) {
    return { error: (rpcData as { error: string }).error };
  }

  const result = rpcData as {
    ok?: boolean;
    storage_path?: string | null;
    original_filename?: string | null;
    version_no?: number | null;
    was_latest?: boolean | null;
    promoted_id?: string | null;
  } | null;

  if (!result?.ok || !result.storage_path) {
    return { error: '삭제 처리에 실패했습니다.' };
  }

  // Storage hard delete (실패해도 DB soft delete는 이미 완료 — orphan 가능, activity_log에 기록)
  const { error: storageErr } = await supabase.storage
    .from('contract-files')
    .remove([result.storage_path]);

  await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'file_delete',
    target_type: 'file',
    target_id: input.fileId,
    before_value: {
      contract_id: input.contractId,
      storage_path: result.storage_path,
      original_filename: result.original_filename,
      version_no: result.version_no,
      is_latest: result.was_latest,
    },
    after_value: {
      storage_removed: !storageErr,
      promoted_file_id: result.promoted_id ?? null,
    },
  });

  revalidatePath(`/contracts/${input.contractId}`);
  revalidatePath('/contracts');
  return { ok: true };
}
