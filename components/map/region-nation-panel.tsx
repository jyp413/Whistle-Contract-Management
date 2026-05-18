'use client';

import Link from 'next/link';
import type { LgStat, SidoSummary } from '@/lib/map/types';
import { aggregateBySido } from '@/lib/map/aggregate-by-sido';

export function RegionNationPanel({ lgs }: { lgs: LgStat[] }) {
  const summaries: SidoSummary[] = aggregateBySido(lgs);
  const totalLG = lgs.length;
  const totalCompleted = lgs.reduce((s, l) => s + l.completed, 0);
  const totalMono = lgs.reduce((s, l) => s + l.completed_monoplatform, 0);
  const totalImcity = lgs.reduce((s, l) => s + l.completed_imcity, 0);

  return (
    <aside className="bg-white rounded-md border border-slate-200 shadow-sm">
      <div className="p-5 border-b border-slate-100">
        <p className="text-xs text-slate-500">전국 요약</p>
        <h3 className="text-base font-bold text-slate-900 mt-0.5">광역시도별 계약 현황</h3>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-slate-900 tabular-nums">{totalCompleted}</span>
          <span className="text-xs text-slate-500 tabular-nums">/ {totalLG} 지자체 완료</span>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-orange-400" />
            모노 직접 {totalMono}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-sky-300" />
            아이엠 경유 {totalImcity}
          </span>
        </div>
      </div>
      <ul className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
        {summaries.map((s) => (
          <li key={s.sido} className="px-5 py-2.5 text-sm hover:bg-slate-50">
            <Link
              href={`/contracts?q=${encodeURIComponent(s.sido)}`}
              className="flex items-center justify-between gap-2"
            >
              <span className="text-slate-800 truncate flex-1">{s.sido}</span>
              <span className="tabular-nums text-slate-900 font-semibold">
                {s.completed}
                <span className="text-slate-400 font-normal"> / {s.lg_count}</span>
              </span>
            </Link>
            {(s.completed_monoplatform > 0 || s.completed_imcity > 0) && (
              <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500 tabular-nums">
                {s.completed_monoplatform > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-sm bg-orange-400" />
                    모노 {s.completed_monoplatform}
                  </span>
                )}
                {s.completed_imcity > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-sm bg-sky-300" />
                    아이엠 {s.completed_imcity}
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
