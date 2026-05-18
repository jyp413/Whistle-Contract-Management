import type { Coverage, LgStat, PartyTint } from './types';

// 지자체 커버리지: 'completed' 1건 이상 보유한 LG 비율.
export function coverageRate(lgs: LgStat[]): Coverage {
  if (lgs.length === 0) return { rate: null, covered: 0, total: 0 };
  const covered = lgs.filter((l) => l.completed > 0).length;
  return { rate: covered / lgs.length, covered, total: lgs.length };
}

// 활성 메인 계약(`status=completed AND master_contract_id IS NULL`)의 contracting_party 우선순위로 색 결정.
// monoplatform 1건 이상 → 오렌지, imcity만 → 하늘색, 없으면 회색.
export function partyTint(s: Pick<LgStat, 'completed_monoplatform' | 'completed_imcity'>): PartyTint {
  if (s.completed_monoplatform > 0) return 'monoplatform';
  if (s.completed_imcity > 0) return 'imcity';
  return 'none';
}

const TINT_FILL: Record<PartyTint, string> = {
  monoplatform: 'fill-orange-400',
  imcity: 'fill-sky-300',
  none: 'fill-slate-200',
};

export function partyColor(s: Pick<LgStat, 'completed_monoplatform' | 'completed_imcity'>): string {
  return TINT_FILL[partyTint(s)];
}

export const TINT_LABEL: Record<PartyTint, string> = {
  monoplatform: '모노플랫폼 직접',
  imcity: '아이엠시티 경유',
  none: '미체결',
};

// (legacy) coverage 그라데이션 — 더 이상 지도에서 직접 사용하지 않지만 다른 코드 참조 대비 유지.
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
