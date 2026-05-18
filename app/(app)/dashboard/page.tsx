import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import {
  fmtDate,
  daysUntil,
  effectiveExpiry,
} from '@/lib/utils';
import { RegionMapCard } from '@/components/map/region-map-card';
import type { LgStat } from '@/lib/map/types';
import SearchBox from './search-box';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();

  const [
    { data: kpiRows },
    { data: expiring },
    { data: regionRows, error: regionErr },
  ] = await Promise.all([
    supabase.rpc('get_kpi_summary'),
    supabase
      .from('contracts')
      .select(
        'id, status, expiry_date, extended_expiry_date, local_governments(full_name, sigungu)',
      )
      .eq('status', 'completed')
      .is('deleted_at', null)
      .order('expiry_date', { ascending: true, nullsFirst: false })
      .limit(50),
    supabase.rpc('get_region_stats'),
  ]);

  if (regionErr) {
    console.error('[dashboard] get_region_stats failed:', regionErr.message);
  }
  const regionStats: LgStat[] = (regionRows ?? []) as LgStat[];

  const kpi = kpiRows?.[0] ?? {
    completed_count: 0,
    in_progress_count: 0,
    updating_count: 0,
    total_active: 0,
    expiring_60d: 0,
    expiring_30d: 0,
    expiring_7d: 0,
  };

  const expiringSoon = (expiring ?? []).filter((c) => {
    const d = daysUntil(effectiveExpiry(c));
    return d !== null && d >= 0 && d <= 60;
  });

  return (
    <div className="space-y-6">
      {sp.error === 'forbidden' && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-2 rounded">
          해당 작업에 대한 권한이 없습니다.
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold text-slate-900">대시보드</h1>
        <p className="text-sm text-slate-500 mt-1">
          전체 활성 계약 {kpi.total_active}건 (종료 제외)
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          title="계약완료"
          value={kpi.completed_count}
          total={kpi.total_active}
          tone="green"
          href="/contracts?status=completed"
        />
        <KpiCard
          title="체결중"
          value={kpi.in_progress_count}
          total={kpi.total_active}
          tone="orange"
          href="/contracts?status=in_progress"
        />
        <KpiCard
          title="갱신중"
          value={kpi.updating_count}
          total={kpi.total_active}
          tone="blue"
          href="/contracts?status=updating"
        />
      </div>

      <SearchBox />

      <RegionMapCard stats={regionStats} />

      <div className="bg-white rounded-lg shadow-sm border border-slate-200">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            만료 임박 계약 (60일 이내)
          </h2>
          <span className="text-xs text-slate-500">
            60일 {kpi.expiring_60d} · 30일 {kpi.expiring_30d} · 7일{' '}
            {kpi.expiring_7d}
          </span>
        </div>
        {expiringSoon.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            만료 임박 계약이 없습니다.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 bg-slate-50">
                <th className="text-left px-5 py-2 font-medium">지자체</th>
                <th className="text-left px-5 py-2 font-medium">실효 만료일</th>
                <th className="text-right px-5 py-2 font-medium">D-day</th>
              </tr>
            </thead>
            <tbody>
              {expiringSoon.slice(0, 10).map((c) => {
                const d = daysUntil(effectiveExpiry(c));
                return (
                  <tr
                    key={c.id}
                    className="border-t border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-5 py-2">
                      <Link
                        href={`/contracts/${c.id}`}
                        className="text-slate-900 hover:text-indigo-600"
                      >
                        {c.local_governments?.full_name ?? '-'}
                      </Link>
                    </td>
                    <td className="px-5 py-2 text-slate-700 tabular-nums">
                      {fmtDate(effectiveExpiry(c))}
                    </td>
                    <td
                      className={`px-5 py-2 text-right tabular-nums ${
                        d !== null && d <= 7
                          ? 'text-red-600 font-semibold'
                          : d !== null && d <= 30
                            ? 'text-amber-600'
                            : 'text-slate-700'
                      }`}
                    >
                      {d !== null ? `D-${d}` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  title,
  value,
  total,
  tone,
  href,
}: {
  title: string;
  value: number;
  total: number;
  tone: 'green' | 'orange' | 'blue';
  href: string;
}) {
  const toneClass = {
    green: 'border-l-emerald-500',
    orange: 'border-l-orange-500',
    blue: 'border-l-blue-500',
  }[tone];
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <Link
      href={href}
      className={`bg-white rounded-lg shadow-sm border border-slate-200 border-l-4 ${toneClass} p-5 hover:shadow transition`}
    >
      <p className="text-xs text-slate-500 font-medium">{title}</p>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-3xl font-bold text-slate-900 tabular-nums">
          {value}
        </span>
        <span className="text-sm text-slate-500 mb-1 tabular-nums">
          / {total} ({pct}%)
        </span>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">클릭하여 리스트 보기 →</p>
    </Link>
  );
}
