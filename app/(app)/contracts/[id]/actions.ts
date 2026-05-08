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
 * - 낙관락 + activity_logs(contract_delete) 기록.
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
    return { error: '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.' };
  }

  const { data: upd, error: e2 } = await supabase
    .from('contracts')
    .update({
      deleted_at: new Date().toISOString(),
      version: cur.version + 1,
      updated_by: me.id,
    })
    .eq('id', input.contractId)
    .eq('version', cur.version)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (e2 || !upd) {
    return { error: '동시 수정 충돌이 발생했습니다. 새로고침 후 다시 시도하세요.' };
  }

  await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'contract_delete',
    target_type: 'contract',
    target_id: input.contractId,
    before_value: { status: cur.status, deleted_at: null },
    after_value: { deleted_at: new Date().toISOString() },
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
