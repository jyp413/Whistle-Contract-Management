'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireWriter } from '@/lib/auth';

/**
 * Storage 업로드 직후 호출.
 *  1) contract_files INSERT (다음 version_no, is_latest=TRUE)
 *  2) 기존 latest 해제
 *  3) activity_logs 기록
 */
export async function registerUploadedFile(input: {
  contractId: string;
  storagePath: string;
  originalFilename: string;
  fileSizeBytes: number;
  checksumSha256: string;
}): Promise<{ error?: string; fileId?: string; versionNo?: number }> {
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

  if (error || !inserted) {
    return { error: error?.message ?? '파일 등록 실패' };
  }

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
 * "계약완료로 변경하시겠습니까?" 확인 팝업 승인 시 호출.
 * in_progress / updating → completed
 * 낙관적 락 적용.
 */
export async function confirmCompletion(input: {
  contractId: string;
  expectedVersion: number;
}): Promise<{ error?: string; ok?: boolean }> {
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
    return {
      error: `현재 상태(${cur.status})에서는 계약완료로 전환할 수 없습니다.`,
    };
  }
  if (cur.version !== input.expectedVersion) {
    return {
      error: '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.',
    };
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
    return {
      error: '동시 수정 충돌이 발생했습니다. 새로고침 후 다시 시도하세요.',
    };
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
