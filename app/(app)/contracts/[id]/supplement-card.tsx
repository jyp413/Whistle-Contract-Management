'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { confirmCompletion, registerUploadedFile } from './actions';
import FilePreviewButton from './file-preview';
import {
  STATUS_LABEL,
  STATUS_BADGE,
  TYPE_LABEL,
  TYPE_BADGE,
  fmtDate,
  fmtDateTime,
} from '@/lib/utils';
import type { Database } from '@/lib/types/database';

type Status = Database['public']['Enums']['contract_status'];
type Ctype = Database['public']['Enums']['contract_type'];

const MAX_BYTES = 50 * 1024 * 1024;

export type SupplementInfo = {
  id: string;
  status: Status;
  version: number;
  contract_type: Ctype;
  signed_date: string | null;
  expiry_date: string | null;
  extended_expiry_date: string | null;
  latest_file: {
    id: string;
    storage_path: string;
    original_filename: string;
    version_no: number;
    file_size_bytes: number;
    uploaded_at: string;
  } | null;
};

export default function SupplementCard({
  supplement,
  canUpload,
}: {
  supplement: SupplementInfo;
  canUpload: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [completing, startCompleteTransition] = useTransition();
  const [completeError, setCompleteError] = useState<string | null>(null);

  const canConfirmComplete =
    supplement.status === 'in_progress' || supplement.status === 'updating';

  async function handleUpload(file: File) {
    setError(null);
    setSuccess(null);
    setProgress(null);
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('PDF 파일만 업로드 가능합니다.');
      return;
    }
    if (file.type && file.type !== 'application/pdf') {
      setError(`PDF 파일만 가능 (MIME: ${file.type})`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`파일 크기 ${(file.size / 1024 / 1024).toFixed(1)}MB > 최대 50MB`);
      return;
    }
    setBusy(true);
    setProgress('해시 계산 중…');
    const checksum = await sha256(file);
    const path = `${supplement.id}/${Date.now()}-${crypto.randomUUID()}.pdf`;
    setProgress('Storage 업로드 중…');
    const supabase = createClient();
    const up = await supabase.storage
      .from('contract-files')
      .upload(path, file, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false,
      });
    if (up.error) {
      setError('Storage 업로드 실패: ' + up.error.message);
      setBusy(false);
      setProgress(null);
      return;
    }
    setProgress('레코드 등록 중…');
    const reg = await registerUploadedFile({
      contractId: supplement.id,
      storagePath: path,
      originalFilename: file.name,
      fileSizeBytes: file.size,
      checksumSha256: checksum,
    });
    setBusy(false);
    setProgress(null);
    if (reg.error) {
      setError('레코드 등록 실패: ' + reg.error);
      return;
    }
    setSuccess(`v${reg.versionNo} 업로드 완료`);
    if (fileRef.current) fileRef.current.value = '';
    router.refresh();

    // 메인과 동일한 흐름: 체결중/갱신중 상태에서 업로드 직후 계약완료 모달
    if (canConfirmComplete) {
      setConfirmOpen(true);
    }
  }

  function doConfirmCompletion() {
    setCompleteError(null);
    startCompleteTransition(async () => {
      const r = await confirmCompletion({
        contractId: supplement.id,
        expectedVersion: supplement.version,
      });
      if (r.error) {
        setCompleteError(r.error);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  const effectiveExpiryStr = fmtDate(
    supplement.extended_expiry_date ?? supplement.expiry_date,
  );
  const latest = supplement.latest_file;

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded ring-1 ring-inset ${TYPE_BADGE[supplement.contract_type]}`}
            >
              {TYPE_LABEL[supplement.contract_type]}·부속
            </span>
            <span
              className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded ring-1 ring-inset ${STATUS_BADGE[supplement.status]}`}
            >
              {STATUS_LABEL[supplement.status]}
            </span>
          </div>
          <p className="text-xs text-slate-600 tabular-nums">
            체결 {fmtDate(supplement.signed_date)} · 실효 만료{' '}
            {effectiveExpiryStr}
          </p>
        </div>
        <Link
          href={`/contracts/${supplement.id}`}
          className="text-[11px] text-slate-500 hover:text-indigo-600 underline-offset-2 hover:underline whitespace-nowrap"
        >
          상세 →
        </Link>
      </div>

      {latest ? (
        <div className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs text-slate-900 truncate" title={latest.original_filename}>
              📄 v{latest.version_no} · {latest.original_filename}
            </p>
            <p className="text-[11px] text-slate-500 tabular-nums">
              {(latest.file_size_bytes / 1024 / 1024).toFixed(2)} MB ·{' '}
              {fmtDateTime(latest.uploaded_at)}
            </p>
          </div>
          <FilePreviewButton
            storagePath={latest.storage_path}
            filename={latest.original_filename}
            canDownload={canUpload}
          />
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 px-3 py-2 bg-slate-50 border border-dashed border-slate-200 rounded">
          업로드된 파일이 없습니다.
        </p>
      )}

      {canUpload && (
        <div>
          <div
            onClick={() => !busy && fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (busy) return;
              const f = e.dataTransfer.files?.[0];
              if (f) handleUpload(f);
            }}
            role="button"
            tabIndex={0}
            aria-disabled={busy}
            className={`flex flex-col items-center justify-center text-center px-3 py-3 rounded border-2 border-dashed cursor-pointer transition ${
              dragOver
                ? 'border-orange-500 bg-orange-50'
                : 'border-slate-300 hover:border-orange-400 hover:bg-slate-50'
            } ${busy ? 'opacity-60 pointer-events-none' : ''}`}
          >
            <p className="text-xs font-medium text-slate-800">
              {busy ? '처리 중…' : latest ? '새 버전 업로드' : 'PDF 업로드'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              클릭 또는 파일 드래그
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
            className="hidden"
          />
          {progress && (
            <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-1 mt-2">
              ⏳ {progress}
            </p>
          )}
          {success && (
            <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 mt-2">
              ✓ {success}
            </p>
          )}
          {error && (
            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mt-2">
              ✗ {error}
            </p>
          )}
        </div>
      )}

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          onClick={() => !completing && setConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900">
              부속 계약 상태 변경
            </h3>
            <p className="text-sm text-slate-700 mt-2">
              <b>{TYPE_LABEL[supplement.contract_type]} (부속)</b> 파일이
              업로드되었습니다.
              <br />
              계약 상태를 <b>「계약완료」</b>로 변경하시겠습니까?
            </p>
            {completeError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mt-3">
                {completeError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={completing}
                className="text-sm px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 rounded"
              >
                나중에
              </button>
              <button
                type="button"
                onClick={doConfirmCompletion}
                disabled={completing}
                className="text-sm px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded font-medium"
              >
                {completing ? '처리 중…' : '확인 — 계약완료로 변경'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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
