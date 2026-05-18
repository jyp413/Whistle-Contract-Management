import type { LgStat, SidoSummary } from './types';

// 시도별로 LgStat을 묶어 합계 카드 데이터로 변환.
export function aggregateBySido(lgs: LgStat[]): SidoSummary[] {
  const m = new Map<string, SidoSummary>();
  for (const lg of lgs) {
    const cur = m.get(lg.sido) ?? {
      sido: lg.sido,
      lg_count: 0,
      completed: 0,
      completed_monoplatform: 0,
      completed_imcity: 0,
    };
    cur.lg_count += 1;
    cur.completed += lg.completed;
    cur.completed_monoplatform += lg.completed_monoplatform;
    cur.completed_imcity += lg.completed_imcity;
    m.set(lg.sido, cur);
  }
  return Array.from(m.values()).sort((a, b) => b.completed - a.completed);
}

// 시도 또는 시도 + 시군구 묶음의 partyTint 결정용 — LgStat[] 합계로 partyColor 사용 가능하게.
export function sumParty(lgs: LgStat[]): { completed_monoplatform: number; completed_imcity: number } {
  let m = 0;
  let i = 0;
  for (const lg of lgs) {
    m += lg.completed_monoplatform;
    i += lg.completed_imcity;
  }
  return { completed_monoplatform: m, completed_imcity: i };
}
