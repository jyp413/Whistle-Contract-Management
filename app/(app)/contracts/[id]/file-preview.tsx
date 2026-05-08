'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const SIGNED_URL_TTL_SECONDS = 60 * 5; // 5분

export default function FilePreviewButton({
  storagePath,
  filename,
  canDownload,
}: {
  storagePath: string;
  filename: string;
  canDownload: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPreview() {
    setOpen(true);
    if (url || loading) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from('contract-files')
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    setLoading(false);
    if (error || !data) {
      setError(error?.message ?? 'URL 발급 실패');
      return;
    }
    setUrl(data.signedUrl);
  }

  function close() {
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={openPreview}
        className="text-xs font-medium px-2.5 py-1 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded"
      >
        미리보기
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 flex flex-col items-stretch p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label={`${filename} 미리보기`}
        >
          <div
            className="bg-white rounded-lg shadow-xl flex flex-col flex-1 max-w-6xl w-full mx-auto overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50">
              <p className="text-sm font-medium text-slate-900 truncate">
                {filename}
              </p>
              <div className="flex items-center gap-2">
                {canDownload && url && (
                  <a
                    href={url}
                    download={filename}
                    className="text-xs font-medium px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded"
                  >
                    다운로드
                  </a>
                )}
                <button
                  type="button"
                  onClick={close}
                  className="text-xs px-3 py-1 border border-slate-300 bg-white hover:bg-slate-100 rounded"
                  aria-label="닫기"
                >
                  닫기 ✕
                </button>
              </div>
            </div>
            <div className="flex-1 bg-slate-100 relative">
              {loading && (
                <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
                  PDF 로딩 중…
                </p>
              )}
              {error && (
                <p className="absolute inset-0 flex items-center justify-center text-sm text-red-600 px-6 text-center">
                  미리보기를 불러오지 못했습니다: {error}
                </p>
              )}
              {url && !error && (
                <iframe
                  src={url}
                  title={filename}
                  className="w-full h-full"
                  // PDF 뷰어가 자체적으로 다운로드/인쇄/네비게이션 제공
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
