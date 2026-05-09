import type { LgStat } from './types';

// full_name 토큰 분해. 결과:
//   세종특별자치시           → { sido:'세종특별자치시', parent_si:null, leaf:'세종특별자치시' }
//   서울특별시 종로구         → { sido:'서울특별시',     parent_si:null, leaf:'종로구' }
//   경기도 가평군             → { sido:'경기도',         parent_si:null, leaf:'가평군' }
//   경기도 수원시 장안구       → { sido:'경기도',         parent_si:'수원시', leaf:'장안구' }
export function splitFullName(full_name: string): {
  sido: string;
  parent_si: string | null;
  leaf: string;
} {
  const parts = full_name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { sido: parts[0], parent_si: null, leaf: parts[0] };
  if (parts.length === 2) return { sido: parts[0], parent_si: null, leaf: parts[1] };
  return { sido: parts[0], parent_si: parts[1], leaf: parts.slice(2).join(' ') };
}

// 광역시도(2자리) ↔ 시드 sido 한글명. 일부 명칭은 행정구역 개편 후
// 변경됨(강원도→강원특별자치도, 전라북도→전북특별자치도). DB의 한글명을 정답으로 둔다.
export const SIDO_BY_GEO_CODE: Record<string, string> = {
  '11': '서울특별시',
  '21': '부산광역시',
  '22': '대구광역시',
  '23': '인천광역시',
  '24': '광주광역시',
  '25': '대전광역시',
  '26': '울산광역시',
  '29': '세종특별자치시',
  '31': '경기도',
  '32': '강원특별자치도',
  '33': '충청북도',
  '34': '충청남도',
  '35': '전북특별자치도',
  '36': '전라남도',
  '37': '경상북도',
  '38': '경상남도',
  '39': '제주특별자치도',
};

// geo 폴리곤 name(예: '수원시장안구', '가평군')에서 parent_si 추출.
// 수원시·성남시 등 일반구를 가진 시는 polygon name에 시 이름 prefix가 붙어 있음.
// 부천시(31050)는 통합 시이므로 parent_si 없음 — 자기 자신이 leaf.
const PARENT_SI_PREFIXES = [
  '수원시',
  '성남시',
  '안양시',
  '부천시', // 통합폐지 — prefix는 안 붙음, leaf로만 등장
  '안산시',
  '고양시',
  '용인시',
  '청주시',
  '천안시',
  '전주시',
  '포항시',
  '창원시',
];

export function splitPolygonName(name: string): {
  parent_si: string | null;
  leaf: string;
} {
  for (const prefix of PARENT_SI_PREFIXES) {
    if (name.startsWith(prefix) && name.length > prefix.length) {
      return { parent_si: prefix, leaf: name.slice(prefix.length) };
    }
  }
  return { parent_si: null, leaf: name };
}

// 영역(여러 LG)에 속한 stats 합산.
export function rollup(stats: LgStat[]) {
  const sum = { total: 0, completed: 0, in_progress: 0, updating: 0, terminated: 0 };
  for (const s of stats) {
    sum.total += s.total;
    sum.completed += s.completed;
    sum.in_progress += s.in_progress;
    sum.updating += s.updating;
    sum.terminated += s.terminated;
  }
  return sum;
}
