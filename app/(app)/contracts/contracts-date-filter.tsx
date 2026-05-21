'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type FieldKey = 'signed' | 'effective' | 'expiry';

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'signed', label: '계약체결일' },
  { key: 'effective', label: '계약시작일' },
  { key: 'expiry', label: '계약만료일' },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS: number[] = [];
for (let y = 2015; y <= CURRENT_YEAR + 10; y += 1) YEARS.push(y);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

type Bound = { y: string; m: string };

function splitYM(ym: string | null): Bound {
  if (ym && /^\d{4}-\d{2}$/.test(ym)) {
    const [y, m] = ym.split('-');
    return { y, m };
  }
  return { y: '', m: '' };
}

const EMPTY: Bound = { y: '', m: '' };

export default function ContractsDateFilter() {
  const router = useRouter();
  const sp = useSearchParams();

  // 현재 쿼리에 값이 있는 날짜 종류를 골라 초기 상태 구성 (없으면 계약체결일)
  const [field, setField] = useState<FieldKey>(() => {
    const hit = FIELDS.find(
      (f) => sp.get(`${f.key}_from`) || sp.get(`${f.key}_to`),
    );
    return hit?.key ?? 'signed';
  });
  const [from, setFrom] = useState<Bound>(() => splitYM(sp.get(`${field}_from`)));
  const [to, setTo] = useState<Bound>(() => splitYM(sp.get(`${field}_to`)));

  // 날짜 종류 변경 시 그 종류에 저장된 값으로 입력칸을 다시 채움
  function changeField(next: FieldKey) {
    setField(next);
    setFrom(splitYM(sp.get(`${next}_from`)));
    setTo(splitYM(sp.get(`${next}_to`)));
  }

  // from: 연도만 → YYYY-01, 연+월 → YYYY-MM, 연 없음 → ''
  // to:   연도만 → YYYY-12, 연+월 → YYYY-MM, 연 없음 → ''
  function resolve(b: Bound, side: 'from' | 'to'): string {
    if (!b.y) return '';
    return `${b.y}-${b.m || (side === 'from' ? '01' : '12')}`;
  }

  function clearAllDateKeys(params: URLSearchParams) {
    for (const f of FIELDS) {
      params.delete(`${f.key}_from`);
      params.delete(`${f.key}_to`);
    }
  }

  function apply() {
    const params = new URLSearchParams(sp.toString());
    clearAllDateKeys(params); // 한 번에 한 종류만 — 나머지 종류 조건은 제거
    const fromV = resolve(from, 'from');
    const toV = resolve(to, 'to');
    if (fromV) params.set(`${field}_from`, fromV);
    if (toV) params.set(`${field}_to`, toV);
    params.delete('page');
    const qs = params.toString();
    router.push(qs ? `/contracts?${qs}` : '/contracts');
  }

  function reset() {
    const params = new URLSearchParams(sp.toString());
    clearAllDateKeys(params);
    params.delete('page');
    setFrom({ ...EMPTY });
    setTo({ ...EMPTY });
    const qs = params.toString();
    router.push(qs ? `/contracts?${qs}` : '/contracts');
  }

  const hasActive = FIELDS.some(
    (f) => sp.get(`${f.key}_from`) || sp.get(`${f.key}_to`),
  );

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="text-xs text-slate-500 mb-2">날짜 조회 (월 단위)</div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={field}
          onChange={(e) => changeField(e.target.value as FieldKey)}
          className="text-xs px-2 py-1 border border-slate-300 rounded bg-white text-slate-700 font-medium"
          aria-label="날짜 종류"
        >
          {FIELDS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <YmSelect bound={from} onChange={setFrom} />
        <span className="text-xs text-slate-400">~</span>
        <YmSelect bound={to} onChange={setTo} />
        {field === 'expiry' && (
          <span className="text-[11px] text-slate-400">
            ※ 계약서상 만료일 기준 (자동연장 미반영)
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={!hasActive}
            className="text-sm px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            초기화
          </button>
          <button
            type="button"
            onClick={apply}
            className="text-sm px-4 py-1.5 border border-slate-900 bg-slate-900 text-white hover:bg-slate-800 rounded"
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
}

function YmSelect({
  bound,
  onChange,
}: {
  bound: Bound;
  onChange: (b: Bound) => void;
}) {
  const selectCls =
    'text-xs px-2 py-1 border border-slate-300 rounded bg-white text-slate-700';
  return (
    <span className="inline-flex gap-1">
      <select
        value={bound.y}
        onChange={(e) => onChange({ ...bound, y: e.target.value })}
        className={selectCls}
        aria-label="연도"
      >
        <option value="">연도</option>
        {YEARS.map((y) => (
          <option key={y} value={String(y)}>
            {y}년
          </option>
        ))}
      </select>
      <select
        value={bound.m}
        onChange={(e) => onChange({ ...bound, m: e.target.value })}
        className={selectCls}
        aria-label="월"
      >
        <option value="">월</option>
        {MONTHS.map((m) => (
          <option key={m} value={String(m).padStart(2, '0')}>
            {m}월
          </option>
        ))}
      </select>
    </span>
  );
}
