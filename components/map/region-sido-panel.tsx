'use client';

import Link from 'next/link';
import type { LgStat } from '@/lib/map/types';

export function RegionSidoPanel({ sido, lgs }: { sido: string; lgs: LgStat[] }) {
  const totalLG = lgs.length;
  const completedLG = lgs.filter((l) => l.completed > 0).length;
  const totalMono = lgs.reduce((s, l) => s + l.completed_monoplatform, 0);
  const totalImcity = lgs.reduce((s, l) => s + l.completed_imcity, 0);

  // 시군구를 가나다 + 체결 여부 순으로 정렬
  const sorted = [...lgs].sort((a, b) => {
    if ((b.completed > 0 ? 1 : 0) !== (a.completed > 0 ? 1 : 0)) {
      return (b.completed > 0 ? 1 : 0) - (a.completed > 0 ? 1 : 0);
    }
    return a.full_name.localeCompare(b.full_name, 'ko');
  });

  return (
    <aside className="bg-white rounded-md border border-slate-200 shadow-sm">
      <div className="p-5 border-b border-slate-100">
        <p className="text-xs text-slate-500">광역 요약</p>
        <h3 className="text-base font-bold text-slate-900 mt-0.5">{sido}</h3>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-slate-900 tabular-nums">{completedLG}</span>
          <span className="text-xs text-slate-500 tabular-nums">/ {totalLG} 지자체 체결</span>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-orange-400" />
            모노 {totalMono}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-sky-400" />
            아이엠 {totalImcity}
          </span>
        </div>
      </div>
      <ul className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
        {sorted.map((lg) => {
          const hasCompleted = lg.completed > 0;
          return (
            <li key={lg.lg_id} className="px-5 py-2 text-sm hover:bg-slate-50">
              <Link
                href={`/contracts?q=${encodeURIComponent(lg.full_name)}`}
                className="flex items-center justify-between gap-2"
              >
                <span className={`truncate flex-1 ${hasCompleted ? 'text-slate-800' : 'text-slate-400'}`}>
                  {lg.full_name.replace(`${sido} `, '')}
                </span>
                <span className="tabular-nums text-xs">
                  {hasCompleted ? (
                    <span className="text-slate-900 font-semibold">{lg.completed}건</span>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
