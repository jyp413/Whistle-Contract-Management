import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import {
  STATUS_BADGE,
  STATUS_LABEL,
  PARTY_LABEL,
  PARTY_BADGE,
  TYPE_LABEL,
  TYPE_BADGE,
  daysUntil,
  effectiveExpiry,
  fmtDate,
} from '@/lib/utils';

export const dynamic = 'force-dynamic';

const BUCKETS = [
  { label: '7일 이내', max: 7, tone: 'red' },
  { label: '8~30일', min: 8, max: 30, tone: 'amber' },
  { label: '31~60일', min: 31, max: 60, tone: 'slate' },
] as const;

export default async function ExpiringPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const win = parseInt(sp.window ?? '60', 10);
  const validWindow = [7, 30, 60].includes(win) ? win : 60;

  const supabase = await createClient();
  const { data: contracts, error } = await supabase
    .from('contracts')
    .select(
      'id, status, contract_type, contracting_party, master_contract_id, expiry_date, extended_expiry_date, updated_at, local_governments(full_name)',
    )
    .eq('status', 'completed')
    .is('deleted_at', null)
    .order('expiry_date', { ascending: true, nullsFirst: false })
    .limit(500);

  const enriched =
    (contracts ?? [])
      .map((c) => {
        const expiry = effectiveExpiry(c);
        const d = daysUntil(expiry);
        return { ...c, expiry, days: d };
      })
      .filter(
        (c) =>
          c.days !== null &&
          c.days >= 0 &&
          c.days <= validWindow,
      )
      .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
      >
        <span aria-hidden>←</span> 대시보드
      </Link>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">만료 임박 계약</h1>
        <div className="flex gap-1">
          {[7, 30, 60].map((w) => (
            <Link
              key={w}
              href={`/expiring?window=${w}`}
              className={`text-xs px-3 py-1.5 rounded border ${
                validWindow === w
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {w}일 이내
            </Link>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          조회 오류: {error.message}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {BUCKETS.map((b) => {
          const min = 'min' in b ? b.min : 0;
          const max = b.max;
          const items = enriched.filter(
            (c) => (c.days ?? -1) >= min && (c.days ?? 0) <= max,
          );
          const toneCard = {
            red: 'border-l-red-500',
            amber: 'border-l-amber-500',
            slate: 'border-l-slate-400',
          }[b.tone];
          return (
            <div
              key={b.label}
              className={`bg-white border border-slate-200 border-l-4 ${toneCard} rounded-lg p-4`}
            >
              <p className="text-xs font-medium text-slate-500">{b.label}</p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">
                {items.length}
              </p>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 bg-slate-50">
              <th className="text-left px-4 py-2 font-medium">지자체</th>
              <th className="text-left px-4 py-2 font-medium">유형</th>
              <th className="text-left px-4 py-2 font-medium">주체</th>
              <th className="text-left px-4 py-2 font-medium">상태</th>
              <th className="text-left px-4 py-2 font-medium">실효 만료일</th>
              <th className="text-right px-4 py-2 font-medium">D-day</th>
            </tr>
          </thead>
          <tbody>
            {enriched.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  해당 구간에 만료 임박 계약이 없습니다.
                </td>
              </tr>
            )}
            {enriched.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link
                    href={`/contracts/${c.id}`}
                    className="text-slate-900 hover:text-indigo-600 font-medium"
                  >
                    {c.local_governments?.full_name ?? '-'}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded ring-1 ring-inset ${TYPE_BADGE[c.contract_type]}`}>
                    {TYPE_LABEL[c.contract_type]}{c.master_contract_id ? '·부속' : '·메인'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded ring-1 ring-inset ${PARTY_BADGE[c.contracting_party]}`}>
                    {PARTY_LABEL[c.contracting_party]}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded ring-1 ring-inset ${STATUS_BADGE[c.status]}`}
                  >
                    {STATUS_LABEL[c.status]}
                  </span>
                </td>
                <td className="px-4 py-2 tabular-nums">{fmtDate(c.expiry)}</td>
                <td
                  className={`px-4 py-2 text-right tabular-nums ${
                    (c.days ?? 0) <= 7
                      ? 'text-red-600 font-semibold'
                      : (c.days ?? 0) <= 30
                        ? 'text-amber-600'
                        : 'text-slate-700'
                  }`}
                >
                  D-{c.days}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
