import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import {
  daysUntil,
  effectiveExpiry,
  fmtDate,
  canWrite,
  formatAutoRenewalPeriod,
} from '@/lib/utils';
import { StatusBadge, TypeBadge, PartyBadge } from '@/app/components/badges';

export const dynamic = 'force-dynamic';

const BUCKETS = [
  { label: '30일 이내', max: 30, tone: 'red' },
  { label: '31~60일', min: 31, max: 60, tone: 'amber' },
  { label: '61~90일', min: 61, max: 90, tone: 'slate' },
] as const;

export default async function ExpiringPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const win = parseInt(sp.window ?? '90', 10);
  const validWindow = [30, 60, 90].includes(win) ? win : 90;
  const writer = canWrite(me.role);

  const supabase = await createClient();
  const { data: contracts, error } = await supabase
    .from('contracts')
    .select(
      'id, status, contract_type, contracting_party, master_contract_id, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date, updated_at, local_governments(full_name)',
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

  // 자동연장 계약 중 종료일 cap 에 안 걸린 것 = 실제 종료 위험 없음 (다음 주기로 굴러감).
  // effectiveExpiry()는 cap 도달 시 auto_renewal_end_date 를 그대로 반환하므로 일치 비교로 감지.
  const isSafeRenewal = (c: (typeof enriched)[number]): boolean =>
    c.auto_renewal &&
    !(c.auto_renewal_end_date != null && c.expiry === c.auto_renewal_end_date);

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
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[30, 60, 90].map((w) => (
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
          {writer && (
            <a
              href={`/api/export/expiring.xlsx?window=${validWindow}`}
              className="text-xs font-medium px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 rounded text-slate-800"
            >
              📥 엑셀 내보내기
            </a>
          )}
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
          const mains = items.filter((c) => !c.master_contract_id).length;
          const supps = items.length - mains;
          const safe = items.filter(isSafeRenewal).length;
          const actionNeeded = items.length - safe;
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
              <p className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                메인 {mains} · 부속 {supps}
              </p>
              <p className="text-[11px] tabular-nums mt-0.5">
                <span className="text-slate-400">자동연장 {safe}</span>
                {' · '}
                <span className={actionNeeded > 0 ? 'text-rose-600 font-medium' : 'text-slate-400'}>
                  조치 필요 {actionNeeded}
                </span>
              </p>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
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
                  {error ? '데이터를 불러올 수 없습니다.' : '해당 구간에 만료 임박 계약이 없습니다.'}
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
                  <TypeBadge ctype={c.contract_type} isSupplement={!!c.master_contract_id} />
                </td>
                <td className="px-4 py-2">
                  <PartyBadge party={c.contracting_party} />
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-4 py-2 tabular-nums">
                  <div className="flex items-center gap-1.5">
                    <span>{fmtDate(c.expiry)}</span>
                    {c.auto_renewal && (
                      <span
                        className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ring-1 ring-inset ring-orange-200 bg-orange-50 text-orange-700"
                        title={
                          c.auto_renewal_end_date
                            ? `자동연장 ${formatAutoRenewalPeriod(c.auto_renewal_period_months)} (최대 ${c.auto_renewal_end_date})`
                            : `자동연장 ${formatAutoRenewalPeriod(c.auto_renewal_period_months)}`
                        }
                      >
                        🔄 {formatAutoRenewalPeriod(c.auto_renewal_period_months)}
                      </span>
                    )}
                  </div>
                </td>
                <td
                  className={`px-4 py-2 text-right tabular-nums ${
                    isSafeRenewal(c)
                      ? 'text-slate-400'
                      : (c.days ?? 0) <= 30
                        ? 'text-red-600 font-semibold'
                        : (c.days ?? 0) <= 60
                          ? 'text-amber-600'
                          : 'text-slate-700'
                  }`}
                  title={
                    isSafeRenewal(c)
                      ? '자동연장 계약 — 이 시점에 다음 주기로 갱신됩니다 (종료 아님)'
                      : '자동연장 없음 — 만료 전 갱신 착수 필요'
                  }
                >
                  D-{c.days}
                  {isSafeRenewal(c) && <span className="ml-1 text-[10px]">자동갱신</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
