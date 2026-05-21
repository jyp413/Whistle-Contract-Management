'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type FieldKey = 'signed' | 'effective' | 'expiry';

const FIELDS: { key: FieldKey; label: string; note?: string }[] = [
  { key: 'signed', label: '계약체결일' },
  { key: 'effective', label: '계약시작일' },
  {
    key: 'expiry',
    label: '계약만료일',
    note: '※ 계약서상 만료일 기준 (자동연장 미반영)',
  },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS: number[] = [];
for (let y = 2015; y <= CURRENT_YEAR + 10; y += 1) YEARS.push(y);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

type Bound = { y: string; m: string };
type FieldState = { from: Bound; to: Bound };

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

  const [state, setState] = useState<Record<FieldKey, FieldState>>(() => ({
    signed: { from: splitYM(sp.get('signed_from')), to: splitYM(sp.get('signed_to')) },
    effective: {
      from: splitYM(sp.get('effective_from')),
      to: splitYM(sp.get('effective_to')),
    },
    expiry: { from: splitYM(sp.get('expiry_from')), to: splitYM(sp.get('expiry_to')) },
  }));

  function setBound(key: FieldKey, side: 'from' | 'to', patch: Partial<Bound>) {
    setState((prev) => ({
      ...prev,
      [key]: { ...prev[key], [side]: { ...prev[key][side], ...patch } },
    }));
  }

  // from: 연도만 → YYYY-01, 연+월 → YYYY-MM, 연 없음 → ''
  // to:   연도만 → YYYY-12, 연+월 → YYYY-MM, 연 없음 → ''
  function resolve(b: Bound, side: 'from' | 'to'): string {
    if (!b.y) return '';
    return `${b.y}-${b.m || (side === 'from' ? '01' : '12')}`;
  }

  function apply() {
    const params = new URLSearchParams(sp.toString());
    for (const f of FIELDS) {
      const fromV = resolve(state[f.key].from, 'from');
      const toV = resolve(state[f.key].to, 'to');
      if (fromV) params.set(`${f.key}_from`, fromV);
      else params.delete(`${f.key}_from`);
      if (toV) params.set(`${f.key}_to`, toV);
      else params.delete(`${f.key}_to`);
    }
    params.delete('page');
    const qs = params.toString();
    router.push(qs ? `/contracts?${qs}` : '/contracts');
  }

  function reset() {
    const params = new URLSearchParams(sp.toString());
    for (const f of FIELDS) {
      params.delete(`${f.key}_from`);
      params.delete(`${f.key}_to`);
    }
    params.delete('page');
    setState({
      signed: { from: { ...EMPTY }, to: { ...EMPTY } },
      effective: { from: { ...EMPTY }, to: { ...EMPTY } },
      expiry: { from: { ...EMPTY }, to: { ...EMPTY } },
    });
    const qs = params.toString();
    router.push(qs ? `/contracts?${qs}` : '/contracts');
  }

  const hasActive = FIELDS.some(
    (f) =>
      sp.get(`${f.key}_from`) || sp.get(`${f.key}_to`),
  );

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-2">
      <div className="text-xs text-slate-500">날짜 조회 (월 단위)</div>
      {FIELDS.map((f) => (
        <div key={f.key} className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-600 w-[68px] shrink-0">{f.label}</span>
          <YmSelect
            bound={state[f.key].from}
            onChange={(patch) => setBound(f.key, 'from', patch)}
          />
          <span className="text-xs text-slate-400">~</span>
          <YmSelect
            bound={state[f.key].to}
            onChange={(patch) => setBound(f.key, 'to', patch)}
          />
          {f.note && (
            <span className="text-[11px] text-slate-400">{f.note}</span>
          )}
        </div>
      ))}
      <div className="flex justify-end gap-2 pt-1">
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
  );
}

function YmSelect({
  bound,
  onChange,
}: {
  bound: Bound;
  onChange: (patch: Partial<Bound>) => void;
}) {
  const selectCls =
    'text-xs px-2 py-1 border border-slate-300 rounded bg-white text-slate-700';
  return (
    <span className="inline-flex gap-1">
      <select
        value={bound.y}
        onChange={(e) => onChange({ y: e.target.value })}
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
        onChange={(e) => onChange({ m: e.target.value })}
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
