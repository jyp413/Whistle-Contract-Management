'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteContractFile } from './actions';

export default function FileDeleteButton({
  fileId,
  contractId,
  filename,
}: {
  fileId: string;
  contractId: string;
  filename: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const r = await deleteContractFile({ fileId, contractId });
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 border border-red-300 text-red-600 hover:bg-red-50 rounded"
        aria-label="파일 삭제"
        title="파일 삭제"
      >
        🗑️ 삭제
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">파일 영구 삭제</h3>
            <p className="text-sm text-slate-700 leading-relaxed">
              아래 파일을 삭제합니다.
            </p>
            <p className="text-sm font-medium text-slate-900 mt-2 break-all">{filename}</p>
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 mt-3">
              ⚠️ Storage에서 실제 파일이 영구 삭제되며 복구할 수 없습니다. DB 이력은 보존됩니다.
            </p>
            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mt-2">{error}</p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setOpen(false)} className="text-sm px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 rounded">취소</button>
              <button type="button" disabled={pending} onClick={confirmDelete} className="text-sm px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded font-medium">
                {pending ? '삭제 중…' : '영구 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
