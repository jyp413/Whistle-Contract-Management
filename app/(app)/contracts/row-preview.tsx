'use client';

import { useState } from 'react';
import FilePreviewButton from './[id]/file-preview';

export default function RowPreview({
  file,
  canDownload,
}: {
  file: { storage_path: string; original_filename: string } | null;
  canDownload: boolean;
}) {
  const [showNoFile, setShowNoFile] = useState(false);

  if (file) {
    return (
      <FilePreviewButton
        storagePath={file.storage_path}
        filename={file.original_filename}
        canDownload={canDownload}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowNoFile(true);
        }}
        className="text-xs px-2.5 py-1 border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 rounded"
      >
        미리보기
      </button>
      {showNoFile && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          onClick={() => setShowNoFile(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-2xl mb-3">
              !
            </div>
            <h3 className="text-base font-bold text-slate-900">
              PDF 파일 없음
            </h3>
            <p className="text-sm text-slate-700 mt-2">
              PDF 파일이 업로드되지 않았습니다.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              계약 상세에서 PDF를 업로드하면 미리보기가 활성화됩니다.
            </p>
            <button
              type="button"
              onClick={() => setShowNoFile(false)}
              className="mt-5 w-full bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium py-2 rounded"
              autoFocus
            >
              확인
            </button>
          </div>
        </div>
      )}
    </>
  );
}
