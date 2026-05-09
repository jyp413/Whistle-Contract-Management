'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import type { LgStat, View } from '@/lib/map/types';
import { coverageRate, fmtPct } from '@/lib/map/rate';

export type LeafSelection = {
  title: string;
  lgs: LgStat[];
  counts: {
    total: number;
    completed: number;
    in_progress: number;
    updating: number;
    terminated: number;
  };
};

type Props = {
  selection: LeafSelection | null;
  onClose: () => void;
  view: View;
};

export function RegionLeafPanel({ selection, onClose, view }: Props) {
  if (!selection) {
    return (
      <aside className="hidden lg:flex bg-slate-50 rounded-md text-sm text-slate-400 items-center justify-center p-6 min-h-[420px]">
        지자체를 선택하면 상세 정보가 표시됩니다.
      </aside>
    );
  }

  const cov = coverageRate(selection.lgs);
  const c = selection.counts;
  // 검색 쿼리 생성 — /contracts?q={지자체} 로 이동.
  const queryName = selection.lgs[0]?.full_name ?? selection.title;

  const subtitle =
    view.level === 'nation'
      ? '전국'
      : view.level === 'sido'
        ? view.sido
        : `${view.sido} ${view.parent_si}`;

  return (
    <aside className="bg-white rounded-md border border-slate-200 shadow-sm relative">
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-700"
        aria-label="닫기"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="p-5 border-b border-slate-100">
        <p className="text-xs text-slate-500">{subtitle}</p>
        <h3 className="text-base font-bold text-slate-900 mt-0.5">{selection.title}</h3>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-slate-900 tabular-nums">{fmtPct(cov.rate)}</span>
          <span className="text-xs text-slate-500 tabular-nums">
            계약체결 {cov.covered} / {cov.total} 지자체
          </span>
        </div>
      </div>
      <dl className="p-5 grid grid-cols-2 gap-y-2 text-sm">
        <CountRow label="총 계약" value={c.total} tone="slate" />
        <CountRow label="계약완료" value={c.completed} tone="green" />
        <CountRow label="체결중" value={c.in_progress} tone="orange" />
        <CountRow label="갱신중" value={c.updating} tone="blue" />
        <CountRow label="종료" value={c.terminated} tone="gray" />
      </dl>

      {selection.lgs.length > 1 && (
        <div className="px-5 pb-3">
          <p className="text-xs text-slate-500 mb-1.5">포함 지자체 ({selection.lgs.length})</p>
          <ul className="text-xs text-slate-700 space-y-1">
            {selection.lgs.map((lg) => (
              <li key={lg.lg_id} className="flex justify-between gap-2">
                <span className="truncate">{lg.full_name}</span>
                <span className="tabular-nums text-slate-500">
                  {lg.completed}/{lg.total}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-5 pb-5">
        <Link
          href={`/contracts?q=${encodeURIComponent(queryName)}`}
          className="inline-flex items-center justify-center w-full bg-indigo-600 text-white text-sm font-medium px-3 py-2 rounded hover:bg-indigo-700 transition"
        >
          계약 목록 보기
        </Link>
      </div>
    </aside>
  );
}

function CountRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'slate' | 'green' | 'orange' | 'blue' | 'gray';
}) {
  const dotClass = {
    slate: 'bg-slate-400',
    green: 'bg-emerald-500',
    orange: 'bg-orange-500',
    blue: 'bg-blue-500',
    gray: 'bg-gray-400',
  }[tone];
  return (
    <>
      <dt className="flex items-center gap-1.5 text-slate-600">
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        {label}
      </dt>
      <dd className="text-right font-semibold text-slate-900 tabular-nums">{value}</dd>
    </>
  );
}
