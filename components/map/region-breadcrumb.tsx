'use client';

import { ChevronRight } from 'lucide-react';
import type { View } from '@/lib/map/types';

type Props = {
  view: View;
  onNavigate: (view: View) => void;
};

export function RegionBreadcrumb({ view, onNavigate }: Props) {
  const items: Array<{ label: string; target: View; current?: boolean }> = [];
  items.push({ label: '전국', target: { level: 'nation' } });

  if (view.level === 'sido' || view.level === 'si') {
    items.push({
      label: view.sido,
      target: { level: 'sido', sido: view.sido },
      current: view.level === 'sido',
    });
  }
  if (view.level === 'si') {
    items.push({
      label: view.parent_si,
      target: view,
      current: true,
    });
  }
  if (view.level === 'nation') {
    items[0].current = true;
  }

  return (
    <nav className="flex items-center gap-1 text-sm" aria-label="지역 탐색 경로">
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
          {it.current ? (
            <span className="font-semibold text-slate-900">{it.label}</span>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate(it.target)}
              className="text-slate-500 hover:text-indigo-600 transition"
            >
              {it.label}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}
