'use client';

import { useEffect } from 'react';

/**
 * 공통 Modal 컴포넌트.
 * - Escape 로 닫힘
 * - role="dialog" + aria-modal="true"
 * - 백드롭 클릭으로 닫힘 (closeOnBackdrop=false 로 비활성 가능)
 * - 크기는 maxWidth 로 제어
 *
 * Footer / Field 등 폼 보조는 콜러가 children 으로 직접 구성.
 */
export default function Modal({
  title,
  onClose,
  children,
  maxWidth = 'md',
  closeOnBackdrop = true,
  ariaLabel,
}: {
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  closeOnBackdrop?: boolean;
  ariaLabel?: string;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const widthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  }[maxWidth];

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={closeOnBackdrop ? onClose : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
    >
      <div
        className={`bg-white rounded-lg shadow-xl w-full ${widthClass} max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-900 text-xl leading-none"
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        )}
        <div className={title ? 'p-5' : 'p-6'}>{children}</div>
      </div>
    </div>
  );
}
