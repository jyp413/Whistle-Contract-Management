'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireMaster, requireWriter } from '@/lib/auth';

type Result<T = Record<string, never>> =
  | ({ error: string } & Partial<T>)
  | ({ error?: undefined } & T);

/**
 * Storage 업로드 직후 호출. 다음 version_no, is_latest=TRUE 처리.
 */
export async function registerUploadedFile(input: {
  contractId: string;
  storagePath: string;
  originalFilename: string;
  fileSizeBytes: number;
  checksumSha256: string;
}): Promise<Result<{ fileId: string; versionNo: number }>> {
  const me = await requireWriter();
  const supabase = await createClient();

  const latestRes = await supabase
    .from('contract_files')
    .select('version_no')
    .eq('contract_id', input.contractId)
    .order('version_no', { ascending: false })
    .limit(1);

  const nextVersion = (latestRes.data?.[0]?.version_no ?? 0) + 1;

  await supabase
    .from('contract_files')
    .update({ is_latest: false })
    .eq('contract_id', input.contractId)
    .eq('is_latest', true);

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

  await supabase.from('activity_logs').insert({
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

  revalidatePath(`/contracts/${input.contractId}`);
  return { fileId: inserted.id, versionNo: nextVersion };
}

/**
 * "계약완료로 변경하시겠습니까?" 승인 → in_progress / updating → completed
 */
export async function confirmCompletion(input: {
  contractId: string;
  expectedVersion: number;
}): Promise<Result<{ ok: true }>> {
  const me = await requireWriter();
  const supabase = await createClient();

  const { data: cur, error: e1 } = await supabase
    .from('contracts')
    .select('id, status, version')
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

  const fromStatus = cur.status;
  const { data: upd, error: e2 } = await supabase
    .from('contracts')
    .update({
      status: 'completed',
      version: cur.version + 1,
      updated_by: me.id,
    })
    .eq('id', input.contractId)
    .eq('version', cur.version)
    .is('deleted_at', null)
    .select('id, version')
    .maybeSingle();

  if (e2 || !upd) {
    return { error: '동시 수정 충돌이 발생했습니다. 새로고침 후 다시 시도하세요.' };
  }

  await supabase.from('contract_status_history').insert({
    contract_id: input.contractId,
    from_status: fromStatus,
    to_status: 'completed',
    transition_type: 'file_upload_confirm',
    trigger_event: '확인 팝업 승인',
    changed_by: me.id,
  });

  await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'status_change',
    target_type: 'contract',
    target_id: input.contractId,
    before_value: { status: fromStatus },
    after_value: { status: 'completed' },
  });

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
      'id, status, version, expiry_date, extended_expiry_date',
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

  const previousEffective = cur.extended_expiry_date ?? cur.expiry_date;
  if (!previousEffective) {
    return { error: '기존 만료일이 설정되어 있지 않아 연장할 수 없습니다.' };
  }
  if (input.newExpiryDate <= previousEffective) {
    return { error: '새 만료일은 기존 실효 만료일보다 이후여야 합니다.' };
  }

  // contracts.extended_expiry_date > expiry_date 제약 — 항상 만족 (newExpiryDate > previousEffective >= expiry_date)
  const { error: e2 } = await supabase
    .from('contracts')
    .update({
      extended_expiry_date: input.newExpiryDate,
      version: cur.version + 1,
      updated_by: me.id,
    })
    .eq('id', input.contractId)
    .eq('version', cur.version)
    .is('deleted_at', null);

  if (e2) return { error: '동시 수정 충돌. 새로고침 후 다시 시도하세요.' };

  await supabase.from('contract_extensions').insert({
    contract_id: input.contractId,
    previous_expiry_date: previousEffective,
    new_expiry_date: input.newExpiryDate,
    reason: input.reason || null,
    extended_by: me.id,
  });

  await supabase.from('contract_status_history').insert({
    contract_id: input.contractId,
    from_status: 'completed',
    to_status: 'completed',
    transition_type: 'extend',
    reason: input.reason || null,
    trigger_event: 'extend_button',
    changed_by: me.id,
  });

  await supabase.from('activity_logs').insert({
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
  const { error: e2 } = await supabase
    .from('contracts')
    .update({
      status: 'terminated',
      termination_reason: reason,
      version: cur.version + 1,
      updated_by: me.id,
    })
    .eq('id', input.contractId)
    .eq('version', cur.version)
    .is('deleted_at', null);

  if (e2) return { error: e2.message };

  await supabase.from('contract_status_history').insert({
    contract_id: input.contractId,
    from_status: fromStatus,
    to_status: 'terminated',
    transition_type: 'terminate',
    reason,
    changed_by: me.id,
  });

  await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'status_change',
    target_type: 'contract',
    target_id: input.contractId,
    before_value: { status: fromStatus },
    after_value: { status: 'terminated', reason },
  });

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
      'id, status, version, local_government_id, expiry_date, extended_expiry_date',
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

  const parentExpiry =
    parent.extended_expiry_date ?? parent.expiry_date ?? null;
  let nextStart: string | null = null;
  if (parentExpiry) {
    const d = new Date(parentExpiry);
    d.setDate(d.getDate() + 1);
    nextStart = d.toISOString().slice(0, 10);
  }

  const { data: child, error: e2 } = await supabase
    .from('contracts')
    .insert({
      local_government_id: parent.local_government_id,
      parent_contract_id: parent.id,
      status: 'updating',
      effective_date: nextStart,
      created_by: me.id,
      updated_by: me.id,
    })
    .select('id')
    .single();

  if (e2 || !child) return { error: e2?.message ?? '갱신 계약 생성 실패' };

  await supabase.from('contract_status_history').insert({
    contract_id: child.id,
    from_status: null,
    to_status: 'updating',
    transition_type: 'renew_start',
    trigger_event: `parent=${parent.id}`,
    changed_by: me.id,
  });

  await supabase.from('activity_logs').insert({
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

  await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'contract_delete',
    target_type: 'contract',
    target_id: input.contractId,
    before_value: { status: cur.status, deleted_at: null },
    after_value: { deleted_at: deletedAt },
  });

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
}): Promise<Result<{ ok: true }>> {
  const me = await requireWriter();
  const supabase = await createClient();

  const { data: cur, error: e1 } = await supabase
    .from('contracts')
    .select(
      'id, version, signed_date, effective_date, expiry_date, extended_expiry_date, memo, contract_type, contracting_party, master_contract_id, local_government_id',
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
  if (input.expiry_date && input.expiry_date < today) {
    if (!input.extended_expiry_date) {
      return { error: '만료일이 이미 지났습니다. 연장 후 만료일을 함께 입력하세요.' };
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

  const { error: e2, count } = await supabase
    .from('contracts')
    .update(
      {
        signed_date: input.signed_date,
        effective_date: input.effective_date,
        expiry_date: input.expiry_date,
        extended_expiry_date: input.extended_expiry_date,
        memo: input.memo,
        contract_type: input.contract_type,
        contracting_party: input.contracting_party,
        master_contract_id: input.master_contract_id,
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

  await supabase.from('activity_logs').insert({
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
    },
    after_value: {
      signed_date: input.signed_date,
      effective_date: input.effective_date,
      expiry_date: input.expiry_date,
      extended_expiry_date: input.extended_expiry_date,
      memo: input.memo,
      contract_type: input.contract_type,
      contracting_party: input.contracting_party,
      master_contract_id: input.master_contract_id,
    },
  });

  revalidatePath(`/contracts/${input.contractId}`);
  revalidatePath('/contracts');
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
