'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { confirmCompletion, registerUploadedFile } from './actions';
import type { Database } from '@/lib/types/database';
import Modal from '@/app/components/modal';

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
  const [success, setSuccess] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const canConfirmComplete =
    currentStatus === 'in_progress' || currentStatus === 'updating';

  // 성공 메시지는 4초 후 자동 사라짐
  useEffect(() => {
    if (!success) return;
    const id = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(id);
  }, [success]);

  async function handleUpload(file: File) {
    setError(null);
    setSuccess(null);
    setProgress(null);

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('PDF 파일만 업로드 가능합니다. 선택한 파일: ' + file.name);
      return;
    }
    if (file.type && file.type !== 'application/pdf') {
      setError(
        `PDF 파일만 업로드 가능합니다. 선택한 파일의 MIME: ${file.type || '미지정'}`,
      );
      return;
    }
    if (file.size > MAX_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      setError(`파일 크기 ${mb}MB > 최대 50MB. 다른 파일을 선택하세요.`);
      return;
    }

    setProgress('① 파일 검증 + 해시 계산 중…');
    const checksum = await sha256(file);
    // Supabase Storage 키는 ASCII 만 허용 (한글/특수문자 거부됨).
    // 원본 파일명은 DB contract_files.original_filename 에 한글 그대로 저장.
    const ext = file.name.toLowerCase().endsWith('.pdf') ? '.pdf' : '';
    const path = `${contractId}/${Date.now()}-${crypto.randomUUID()}${ext}`;

    setProgress('② Supabase Storage 업로드 중…');
    const supabase = createClient();
    const { error: uploadErr } = await supabase.storage
      .from('contract-files')
      .upload(path, file, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false,
      });
    if (uploadErr) {
      setError('Storage 업로드 실패: ' + uploadErr.message);
      setProgress(null);
      return;
    }

    setProgress('③ DB 레코드 등록 중…');
    const result = await registerUploadedFile({
      contractId,
      storagePath: path,
      originalFilename: file.name,
      fileSizeBytes: file.size,
      checksumSha256: checksum,
    });

    if (result.error) {
      setError('레코드 등록 실패: ' + result.error);
      setProgress(null);
      return;
    }

    setProgress(null);
    if (fileRef.current) fileRef.current.value = '';
    const sizeMB = (file.size / 1024 / 1024).toFixed(2);
    setSuccess(
      `✓ "${file.name}" (${sizeMB} MB) v${result.versionNo} 업로드 완료`,
    );
    router.refresh();

    // 체결중/갱신중일 때만 확인 팝업
    if (canConfirmComplete) {
      setConfirmOpen(true);
    }
  }

  function pickFile() {
    fileRef.current?.click();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleUpload(f);
  }

  function handleConfirm() {
    startTransition(async () => {
      // prop `currentVersion` 을 그대로 사용 — router.refresh() 이후 부모 페이지가 새로운 version을
      // prop으로 다시 내려주므로 로컬 state로 +1 누적하지 않는다. 충돌 시 서버가 409 반환.
      const result = await confirmCompletion({
        contractId,
        expectedVersion: currentVersion,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <aside className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">PDF 업로드</h2>
          <p className="text-xs text-slate-500 mt-1">
            단일 파일 최대 50MB · application/pdf
            {existingFileCount > 0 &&
              ` · 새 버전이 v${existingFileCount + 1} 으로 등록됩니다.`}
          </p>
        </div>

        <div
          onClick={pickFile}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          aria-disabled={pending}
          className={`flex flex-col items-center justify-center text-center px-4 py-6 rounded border-2 border-dashed cursor-pointer transition ${
            dragOver
              ? 'border-indigo-500 bg-indigo-50'
              : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'
          } ${pending ? 'opacity-60 pointer-events-none' : ''}`}
        >
          <p className="text-sm font-medium text-slate-900">
            클릭해서 PDF 선택
          </p>
          <p className="text-xs text-slate-500 mt-1">또는 이 영역에 드래그</p>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            disabled={pending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
            className="hidden"
          />
        </div>

        {progress && (
          <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-1.5">
            ⏳ {progress}
          </p>
        )}
        {success && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">
            {success}
          </p>
        )}
        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 whitespace-pre-line">
            ✗ {error}
          </p>
        )}
        {currentStatus === 'completed' && (
          <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
            계약완료 상태입니다. 추가 업로드 시 새 버전으로 보존됩니다.
          </p>
        )}
        {currentStatus === 'terminated' && (
          <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1">
            종료된 계약은 파일을 추가하지 않는 것을 권장합니다.
          </p>
        )}
      </aside>

      {confirmOpen && (
        <Modal
          onClose={() => !pending && setConfirmOpen(false)}
          maxWidth="sm"
          closeOnBackdrop={!pending}
          ariaLabel="상태 변경 확인"
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
        </Modal>
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

