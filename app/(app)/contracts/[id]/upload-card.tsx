'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { confirmCompletion, registerUploadedFile } from './actions';
import type { Database } from '@/lib/types/database';

type Status = Database['public']['Enums']['contract_status'];

const MAX_BYTES = 50 * 1024 * 1024;

export default function UploadCard({
  contractId,
  currentStatus,
  currentVersion,
  existingFileCount,
}: {
  contractId: string;
  currentStatus: Status;
  currentVersion: number;
  existingFileCount: number;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [latestVersion, setLatestVersion] = useState(currentVersion);

  const canConfirmComplete =
    currentStatus === 'in_progress' || currentStatus === 'updating';

  async function handleUpload(file: File) {
    setError(null);
    setProgress(null);

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('PDF 파일만 업로드 가능합니다.');
      return;
    }
    if (file.type && file.type !== 'application/pdf') {
      setError('PDF 파일만 업로드 가능합니다.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('파일 크기는 50MB를 초과할 수 없습니다.');
      return;
    }

    setProgress('파일 검증 중…');
    const checksum = await sha256(file);
    const path = `${contractId}/${Date.now()}_${sanitize(file.name)}`;

    setProgress('Supabase Storage 업로드 중…');
    const supabase = createClient();
    const { error: uploadErr } = await supabase.storage
      .from('contract-files')
      .upload(path, file, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false,
      });
    if (uploadErr) {
      setError('업로드 실패: ' + uploadErr.message);
      setProgress(null);
      return;
    }

    setProgress('레코드 등록 중…');
    const result = await registerUploadedFile({
      contractId,
      storagePath: path,
      originalFilename: file.name,
      fileSizeBytes: file.size,
      checksumSha256: checksum,
    });

    if (result.error) {
      setError(result.error);
      setProgress(null);
      return;
    }

    setProgress(null);
    if (fileRef.current) fileRef.current.value = '';
    router.refresh();

    // 체결중/갱신중일 때만 확인 팝업
    if (canConfirmComplete) {
      setConfirmOpen(true);
    }
  }

  function handleConfirm() {
    startTransition(async () => {
      const result = await confirmCompletion({
        contractId,
        expectedVersion: latestVersion,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setConfirmOpen(false);
      setLatestVersion((v) => v + 1);
      router.refresh();
    });
  }

  return (
    <>
      <aside className="bg-white border border-slate-200 rounded-lg p-6 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">PDF 업로드</h2>
        <p className="text-xs text-slate-500">
          단일 파일 최대 50MB · PDF만 허용
          {existingFileCount > 0 && ` · 새 버전이 v${existingFileCount + 1}으로 등록됩니다.`}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          disabled={pending}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
          }}
          className="block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-indigo-600 file:text-white hover:file:bg-indigo-700"
        />
        {progress && (
          <p className="text-xs text-slate-500">⏳ {progress}</p>
        )}
        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
            {error}
          </p>
        )}
        {currentStatus === 'completed' && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
            계약완료 상태입니다. 추가 업로드 시 새 버전으로 보존됩니다.
          </p>
        )}
        {currentStatus === 'terminated' && (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1">
            종료된 계약은 파일을 추가하지 않는 것을 권장합니다.
          </p>
        )}
      </aside>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          onClick={() => !pending && setConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900">
              상태 변경 확인
            </h3>
            <p className="text-sm text-slate-700 mt-2">
              계약 파일이 업로드되었습니다.
              <br />
              계약 상태를 <b>「계약완료」</b>로 변경하시겠습니까?
            </p>
            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mt-3">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={pending}
                className="text-sm px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 rounded"
              >
                나중에
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={pending}
                className="text-sm px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded font-medium"
              >
                {pending ? '처리 중…' : '확인 — 계약완료로 변경'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function sanitize(name: string) {
  return name.replace(/[^\w가-힣.\-]+/g, '_').slice(0, 120);
}
