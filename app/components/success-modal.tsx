'use client';

import { useEffect } from 'react';

export default function SuccessModal({
  message,
  onClose,
  confirmLabel = '확인',
}: {
  message: string;
  onClose: () => void;
  confirmLabel?: string;
}) {
  // Esc 키로 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-2xl mb-3">
          ✓
        </div>
        <h3 className="text-base font-bold text-slate-900">완료</h3>
        <p className="text-sm text-slate-700 mt-2 whitespace-pre-line">{message}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2 rounded"
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
