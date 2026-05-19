'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Modal from '@/app/components/modal';

// pdfjs/react-pdf 는 ~500KB. list 페이지 초기 번들에 포함되지 않도록 lazy.
const FilePreviewButton = dynamic(() => import('./[id]/file-preview'), {
  ssr: false,
  loading: () => (
    <button
      type="button"
      disabled
      className="text-xs px-2.5 py-1 border border-slate-200 bg-slate-50 text-slate-400 rounded"
    >
      미리보기
    </button>
  ),
});

export default function RowPreview({
  file,
  canDownload,
}: {
  file: { id: string; original_filename: string } | null;
  canDownload: boolean;
}) {
  const [showNoFile, setShowNoFile] = useState(false);

  if (file) {
    return (
      <FilePreviewButton
        fileId={file.id}
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
        <Modal onClose={() => setShowNoFile(false)} maxWidth="sm" ariaLabel="PDF 파일 없음">
          <div className="text-center">
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
        </Modal>
      )}
    </>
  );
}
