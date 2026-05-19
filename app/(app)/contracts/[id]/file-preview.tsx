'use client';

import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Worker는 pdfjs-dist 와 동일 버전 사용. CDN 으로 lazy 로드.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function FilePreviewButton({
  fileId,
  filename,
  canDownload,
}: {
  fileId: string;
  filename: string;
  canDownload: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);

  // 모달이 열릴 때 컨테이너 너비 측정
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      if (containerRef.current) {
        setContainerWidth(
          Math.max(360, containerRef.current.clientWidth - 32),
        );
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  // Esc 로 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, numPages, pageNumber]);

  async function openPreview() {
    setOpen(true);
    setPageNumber(1);
    setScale(1.0);
    setNumPages(null);
    setPdfError(null);

    if (url) return; // 이미 설정됨
    setUrlLoading(true);
    setUrlError(null);
    // 세션 바인딩 프록시 URL. writer 는 서버에서 302 redirect, viewer 는 inline 스트리밍.
    setUrl(`/api/preview/${fileId}`);
    setUrlLoading(false);
  }

  function close() {
    setOpen(false);
  }

  function goPrev() {
    setPageNumber((p) => Math.max(1, p - 1));
  }

  function goNext() {
    setPageNumber((p) => (numPages ? Math.min(numPages, p + 1) : p));
  }

  function zoomOut() {
    setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(2)));
  }

  function zoomIn() {
    setScale((s) => Math.min(3.0, +(s + 0.2).toFixed(2)));
  }

  function zoomReset() {
    setScale(1.0);
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
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-slate-200 bg-slate-50 flex-wrap">
              <p className="text-sm font-medium text-slate-900 truncate min-w-0 flex-1">
                {filename}
              </p>

              <div className="flex items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={!numPages || pageNumber <= 1}
                  className="px-2 py-1 border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 rounded"
                  aria-label="이전 페이지"
                >
                  ←
                </button>
                <span className="px-2 tabular-nums text-slate-700 min-w-[60px] text-center">
                  {numPages ? `${pageNumber} / ${numPages}` : '–'}
                </span>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!numPages || pageNumber >= numPages}
                  className="px-2 py-1 border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 rounded"
                  aria-label="다음 페이지"
                >
                  →
                </button>

                <span className="mx-2 h-4 w-px bg-slate-300" />

                <button
                  type="button"
                  onClick={zoomOut}
                  className="px-2 py-1 border border-slate-300 bg-white hover:bg-slate-100 rounded"
                  aria-label="축소"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={zoomReset}
                  className="px-2 py-1 border border-slate-300 bg-white hover:bg-slate-100 rounded tabular-nums min-w-[52px]"
                  aria-label="배율 초기화"
                >
                  {Math.round(scale * 100)}%
                </button>
                <button
                  type="button"
                  onClick={zoomIn}
                  className="px-2 py-1 border border-slate-300 bg-white hover:bg-slate-100 rounded"
                  aria-label="확대"
                >
                  +
                </button>
              </div>

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

            <div
              ref={containerRef}
              className="flex-1 overflow-auto bg-slate-100 flex justify-center p-4"
            >
              {urlLoading && (
                <p className="text-sm text-slate-500 self-center">
                  URL 발급 중…
                </p>
              )}
              {urlError && (
                <p className="text-sm text-red-600 self-center px-6 text-center">
                  미리보기 URL 발급 실패: {urlError}
                </p>
              )}
              {url && !urlError && (
                <Document
                  file={url}
                  onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                  onLoadError={(e: Error) =>
                    setPdfError(e.message ?? 'PDF 로드 실패')
                  }
                  loading={
                    <p className="text-sm text-slate-500">PDF 로드 중…</p>
                  }
                  error={
                    <p className="text-sm text-red-600 px-6 text-center">
                      PDF 를 표시할 수 없습니다. {pdfError}
                    </p>
                  }
                  className="select-text"
                >
                  <Page
                    pageNumber={pageNumber}
                    width={containerWidth * scale}
                    renderAnnotationLayer={true}
                    renderTextLayer={true}
                    className="shadow-lg bg-white"
                  />
                </Document>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
