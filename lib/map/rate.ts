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

// 비율(rate)에 따른 농도 버킷 — Tailwind 색상 단계 6개 (낮음 → 높음).
const ORANGE_BUCKETS: Array<{ max: number; cls: string }> = [
  { max: 0.17, cls: 'fill-orange-100' },
  { max: 0.34, cls: 'fill-orange-200' },
  { max: 0.5, cls: 'fill-orange-300' },
  { max: 0.67, cls: 'fill-orange-400' },
  { max: 0.84, cls: 'fill-orange-500' },
  { max: 1.01, cls: 'fill-orange-600' },
];

const SKY_BUCKETS: Array<{ max: number; cls: string }> = [
  { max: 0.17, cls: 'fill-sky-100' },
  { max: 0.34, cls: 'fill-sky-200' },
  { max: 0.5, cls: 'fill-sky-300' },
  { max: 0.67, cls: 'fill-sky-400' },
  { max: 0.84, cls: 'fill-sky-500' },
  { max: 1.01, cls: 'fill-sky-600' },
];

function pickBucket(rate: number, buckets: typeof ORANGE_BUCKETS): string {
  for (const b of buckets) if (rate <= b.max) return b.cls;
  return buckets[buckets.length - 1].cls;
}

// 폴리곤 단위 색상: 주체(monoplatform 우선) × 비율 버킷.
// 미체결 LG는 회색. LG 자체가 0건이면 slate-200.
export function partyRateColor(lgs: LgStat[]): string {
  if (lgs.length === 0) return 'fill-slate-200';
  const cov = coverageRate(lgs);
  if (cov.rate === null || cov.covered === 0) return 'fill-slate-200';

  let mono = 0;
  let imc = 0;
  for (const l of lgs) {
    mono += l.completed_monoplatform;
    imc += l.completed_imcity;
  }
  if (mono === 0 && imc === 0) return 'fill-slate-200';

  const buckets = mono > 0 ? ORANGE_BUCKETS : SKY_BUCKETS;
  return pickBucket(cov.rate, buckets);
}

// (legacy) 단순 partyColor — 비율 무시. partyRateColor 도입 후 미사용.
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
