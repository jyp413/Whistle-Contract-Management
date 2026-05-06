import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import ZipMenu from './zip-menu';
import {
  STATUS_LABEL,
  STATUS_BADGE,
  fmtDate,
  fmtDateTime,
  canWrite,
  effectiveExpiry,
} from '@/lib/utils';
import type { Database } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

type Status = Database['public']['Enums']['contract_status'];

const STATUS_FILTERS: { key: Status | 'all'; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'in_progress', label: '체결중' },
  { key: 'completed', label: '계약완료' },
  { key: 'updating', label: '갱신중' },
  { key: 'terminated', label: '종료' },
];

export default async function ContractsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const status = (sp.status ?? 'all') as Status | 'all';
  const q = (sp.q ?? '').trim();

  const supabase = await createClient();
  let query = supabase
    .from('contracts')
    .select(
      'id, status, signed_date, effective_date, expiry_date, extended_expiry_date, updated_at, local_governments(full_name, sigungu)',
    )
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(200);

  if (status !== 'all') {
    query = query.eq('status', status);
  }

  const { data: contracts, error } = await query;

  let filtered = contracts ?? [];
  if (q) {
    const needle = q.toLowerCase();
    filtered = filtered.filter((c) =>
      (c.local_governments?.full_name ?? '').toLowerCase().includes(needle),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">계약 목록</h1>
        <div className="flex items-center gap-2">
          {canWrite(me.role) && (
            <>
              <a
                href={`/api/export/contracts.xlsx?${new URLSearchParams({ status, ...(q ? { q } : {}) }).toString()}`}
                className="text-sm font-medium px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 rounded"
              >
                엑셀 내보내기
              </a>
              <ZipMenu status={status} />
              <Link
                href="/contracts/new"
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded"
              >
                + 신규 계약 등록
              </Link>
            </>
          )}
        </div>
      </div>

      <form className="bg-white rounded-lg border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/contracts?${new URLSearchParams({ status: f.key, ...(q ? { q } : {}) }).toString()}`}
              className={`text-xs px-3 py-1.5 rounded border ${
                status === f.key
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="지자체명 검색"
            className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm"
          />
          {status !== 'all' && (
            <input type="hidden" name="status" value={status} />
          )}
        </div>
        <button
          type="submit"
          className="text-sm px-4 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 rounded"
        >
          검색
        </button>
      </form>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          조회 오류: {error.message}
        </p>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 bg-slate-50">
              <th className="text-left px-4 py-2 font-medium">지자체</th>
              <th className="text-left px-4 py-2 font-medium">상태</th>
              <th className="text-left px-4 py-2 font-medium">체결일</th>
              <th className="text-left px-4 py-2 font-medium">시작일</th>
              <th className="text-left px-4 py-2 font-medium">실효 만료일</th>
              <th className="text-left px-4 py-2 font-medium">최종 수정</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  계약이 없습니다.
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr
                key={c.id}
                className="border-t border-slate-100 hover:bg-slate-50"
              >
                <td className="px-4 py-2">
                  <Link
                    href={`/contracts/${c.id}`}
                    className="text-slate-900 hover:text-indigo-600 font-medium"
                  >
                    {c.local_governments?.full_name ?? '-'}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded ring-1 ring-inset ${STATUS_BADGE[c.status]}`}
                  >
                    {STATUS_LABEL[c.status]}
                  </span>
                </td>
                <td className="px-4 py-2 tabular-nums">
                  {fmtDate(c.signed_date)}
                </td>
                <td className="px-4 py-2 tabular-nums">
                  {fmtDate(c.effective_date)}
                </td>
                <td className="px-4 py-2 tabular-nums">
                  {fmtDate(effectiveExpiry(c))}
                </td>
                <td className="px-4 py-2 text-slate-600 text-xs">
                  {fmtDateTime(c.updated_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
