'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { searchAll, type SearchHit, type SearchMatch } from './actions';
import {
  STATUS_LABEL,
  STATUS_BADGE,
  TYPE_LABEL,
  TYPE_BADGE,
  PARTY_LABEL,
  PARTY_BADGE,
  fmtDate,
} from '@/lib/utils';
import type { Database } from '@/lib/types/database';

type Status = Database['public']['Enums']['contract_status'];
type Ctype = Database['public']['Enums']['contract_type'];
type Party = Database['public']['Enums']['contracting_party'];

const MATCH_LABEL: Record<SearchMatch, string> = {
  lg_name: '지자체명',
  memo: '메모',
  termination_reason: '종료 사유',
  contact_department: '담당 부서',
  contact_name: '담당자명',
  contact_phone: '연락처',
  contact_email: '이메일',
  filename: 'PDF 파일명',
};

export default function SearchBox() {
  const [q, setQ] = useState('');
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<{ hits: SearchHit[]; truncated: boolean } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const needle = q.trim();
    if (!needle) {
      setResults(null);
      return;
    }
    startTransition(async () => {
      const r = await searchAll(needle);
      setResults(r);
    });
  }

  function clear() {
    setQ('');
    setResults(null);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex gap-2">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="지자체명·메모·담당자·종료사유·PDF 파일명 검색…"
            className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-md text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
          />
        </div>
        <button
          type="submit"
          disabled={pending || q.trim().length < 2}
          className="text-sm font-medium px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-md shadow-sm"
        >
          {pending ? '검색 중…' : '검색'}
        </button>
        {results && (
          <button type="button" onClick={clear} className="text-sm px-3 py-2.5 border border-slate-300 bg-white hover:bg-slate-50 rounded-md">
            ✕ 닫기
          </button>
        )}
      </form>

      {results && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              검색 결과 {results.hits.length}건
              {results.truncated && <span className="text-xs text-amber-600 ml-2">(많은 결과 — 일부만 표시)</span>}
            </h2>
            <p className="text-xs text-slate-500">"{q}"</p>
          </div>
          {results.hits.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              일치하는 결과가 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
              {results.hits.map((h) => (
                <li key={h.contract_id}>
                  <Link
                    href={`/contracts/${h.contract_id}`}
                    className="block px-5 py-3 hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-900">{h.lg_name}</span>
                      <span className={`inline-flex text-[11px] px-2 py-0.5 rounded ring-1 ring-inset ${TYPE_BADGE[h.contract_type as Ctype]}`}>
                        {TYPE_LABEL[h.contract_type as Ctype]}{h.is_main ? '·메인' : '·부속'}
                      </span>
                      <span className={`inline-flex text-[11px] px-2 py-0.5 rounded ring-1 ring-inset ${PARTY_BADGE[h.contracting_party as Party]}`}>
                        {PARTY_LABEL[h.contracting_party as Party]}
                      </span>
                      <span className={`inline-flex text-[11px] px-2 py-0.5 rounded ring-1 ring-inset ${STATUS_BADGE[h.status as Status]}`}>
                        {STATUS_LABEL[h.status as Status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {h.matches.map((m) => (
                        <span key={m} className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                          {MATCH_LABEL[m]} 일치
                        </span>
                      ))}
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        체결 {fmtDate(h.signed_date)} · 만료 {fmtDate(h.effective_expiry)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
