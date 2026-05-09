import type { LgStat } from './types';

// 특정 시도(2자리 코드)에 속하는 LG들.
export function lgsBySidoCode(stats: LgStat[], sidoCode: string): LgStat[] {
  return stats.filter((s) => s.geo_code?.startsWith(sidoCode));
}

// 특정 polygon code(5자리)와 매칭되는 LG들. 대부분 1개지만 부천시 일반구처럼 N개일 수 있음.
export function lgsByGeoCode(stats: LgStat[], code: string): LgStat[] {
  return stats.filter((s) => s.geo_code === code);
}

// 시도 내 LG 중 parent_si(예: '수원시')에 속하는 LG들.
// LG 쪽 구분은 full_name 토큰으로 한다 (geo polygon name이 아닌).
export function lgsByParentSi(
  stats: LgStat[],
  sidoName: string,
  parentSi: string,
): LgStat[] {
  return stats.filter((s) => {
    if (s.sido !== sidoName) return false;
    const tokens = s.full_name.split(/\s+/).filter(Boolean);
    return tokens.length === 3 && tokens[1] === parentSi;
  });
}

// 같은 도-시(예: 수원시) 안에 일반구가 둘 이상 있는지.
export function hasMultipleSubGu(
  stats: LgStat[],
  sidoName: string,
  parentSi: string,
): boolean {
  return lgsByParentSi(stats, sidoName, parentSi).length > 1;
}
