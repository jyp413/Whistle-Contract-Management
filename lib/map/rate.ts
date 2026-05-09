import type { Coverage, LgStat } from './types';

// 지자체 커버리지: 'completed' 1건 이상 보유한 LG 비율.
export function coverageRate(lgs: LgStat[]): Coverage {
  if (lgs.length === 0) return { rate: null, covered: 0, total: 0 };
  const covered = lgs.filter((l) => l.completed > 0).length;
  return { rate: covered / lgs.length, covered, total: lgs.length };
}

const BUCKETS: Array<{ max: number; cls: string }> = [
  { max: 0.001, cls: 'fill-blue-100' },
  { max: 0.15, cls: 'fill-blue-200' },
  { max: 0.3, cls: 'fill-blue-300' },
  { max: 0.45, cls: 'fill-blue-400' },
  { max: 0.6, cls: 'fill-blue-600' },
  { max: 0.75, cls: 'fill-blue-700' },
  { max: 1.01, cls: 'fill-blue-900' },
];

export function colorClass(rate: number | null): string {
  if (rate === null) return 'fill-slate-200';
  for (const b of BUCKETS) if (rate <= b.max) return b.cls;
  return 'fill-blue-900';
}

export function fmtPct(rate: number | null): string {
  if (rate === null) return 'N/A';
  return `${Math.round(rate * 100)}%`;
}
