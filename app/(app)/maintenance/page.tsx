import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import MaintenanceTable, { type MouSortKey } from './maintenance-table';
import {
  canWrite,
  effectiveExpiry,
} from '@/lib/utils';

export const dynamic = 'force-dynamic';

const SORT_KEYS: ReadonlyArray<MouSortKey> = [
  'lg_name',
  'status',
  'signed_date',
  'effective_expiry',
  'amount_krw',
  'updated_at',
];

const PAGE_SIZES = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 10;
const SERVER_FETCH_CAP = 500;

export default async function MaintenanceListPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    year?: string;
    sort?: string;
    dir?: string;
    page?: string;
    size?: string;
  }>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const yearParam = (sp.year ?? 'all').trim();
  const q = (sp.q ?? '').trim();
  const sort: MouSortKey = (SORT_KEYS as readonly string[]).includes(sp.sort ?? '')
    ? (sp.sort as MouSortKey)
    : 'lg_name';
  const dir: 'asc' | 'desc' = sp.dir === 'desc' ? 'desc' : 'asc';
  const sizeRaw = parseInt(sp.size ?? '', 10);
  const size: (typeof PAGE_SIZES)[number] = (PAGE_SIZES as readonly number[]).includes(sizeRaw)
    ? (sizeRaw as (typeof PAGE_SIZES)[number])
    : DEFAULT_PAGE_SIZE;
  const pageRaw = parseInt(sp.page ?? '1', 10);
  const requestedPage = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const supabase = await createClient();
  const { data: contracts, error } = await supabase
    .from('contracts')
    .select(
      'id, status, signed_date, effective_date, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date, amount_krw, memo, version, contract_type, contracting_party, master_contract_id, local_government_id, updated_at, local_governments(full_name, sigungu, contact_department, contact_name, contact_phone, contact_email)',
    )
    .eq('contract_type', 'mou')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(SERVER_FETCH_CAP);

  const allMou = contracts ?? [];

  // 연도별 요약 — effective_date의 연도 기준 (전체 데이터 기반, 연도 필터와 무관)
  const yearSummaryMap = new Map<string, { count: number; totalAmount: number }>();
  for (const c of allMou) {
    if (!c.effective_date) continue;
    const y = c.effective_date.slice(0, 4);
    const entry = yearSummaryMap.get(y) ?? { count: 0, totalAmount: 0 };
    entry.count += 1;
    if (c.amount_krw != null) entry.totalAmount += c.amount_krw;
    yearSummaryMap.set(y, entry);
  }
  const yearSummary = Array.from(yearSummaryMap.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1)) // 최신 연도가 먼저
    .map(([year, v]) => ({ year, ...v }));

  const availableYears = yearSummary.map((y) => y.year); // 최신부터

  // 연도 필터 적용
  let filtered = allMou;
  if (yearParam !== 'all') {
    filtered = filtered.filter((c) => c.effective_date?.startsWith(yearParam));
  }

  // 검색 필터 — column-wise ilike (보안: .or() DSL 금지)
  if (q) {
    const needle = q.toLowerCase();
    filtered = filtered.filter((c) => {
      const lg = c.local_governments;
      return (
        (lg?.full_name ?? '').toLowerCase().includes(needle) ||
        (lg?.contact_department ?? '').toLowerCase().includes(needle) ||
        (lg?.contact_name ?? '').toLowerCase().includes(needle) ||
        (lg?.contact_phone ?? '').toLowerCase().includes(needle) ||
        (lg?.contact_email ?? '').toLowerCase().includes(needle) ||
        (c.memo ?? '').toLowerCase().includes(needle)
      );
    });
  }

  const sortBy = (a: typeof filtered[number], b: typeof filtered[number]): number => {
    let av: string | number | null = null;
    let bv: string | number | null = null;
    switch (sort) {
      case 'lg_name':
        av = a.local_governments?.full_name ?? '';
        bv = b.local_governments?.full_name ?? '';
        break;
      case 'status':
        av = a.status;
        bv = b.status;
        break;
      case 'signed_date':
        av = a.signed_date ?? '';
        bv = b.signed_date ?? '';
        break;
      case 'effective_expiry':
        av = effectiveExpiry(a) ?? '';
        bv = effectiveExpiry(b) ?? '';
        break;
      case 'amount_krw':
        av = a.amount_krw ?? -1;
        bv = b.amount_krw ?? -1;
        break;
      case 'updated_at':
        av = a.updated_at;
        bv = b.updated_at;
        break;
    }
    if (av === bv) return 0;
    const cmp = (av ?? '') < (bv ?? '') ? -1 : 1;
    return dir === 'asc' ? cmp : -cmp;
  };
  filtered = [...filtered].sort(sortBy);

  const totalEntries = filtered.length;
  const totalPagesCalc = Math.max(1, Math.ceil(totalEntries / size));
  const page = Math.min(Math.max(1, requestedPage), totalPagesCalc);
  const start = (page - 1) * size;
  const paged = filtered.slice(start, start + size);

  const totalPages = Math.max(1, Math.ceil(totalEntries / size));
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
  const fetchCapped = allMou.length >= SERVER_FETCH_CAP;

  const visibleIds = paged.map((c) => c.id);
  const fileMap: Record<string, { id: string; original_filename: string }> = {};
  if (visibleIds.length > 0) {
    const { data: files } = await supabase
      .from('contract_files')
      .select('contract_id, id, original_filename')
      .in('contract_id', visibleIds)
      .eq('is_latest', true)
      .is('deleted_at', null);
    for (const f of files ?? []) {
      fileMap[f.contract_id] = {
        id: f.id,
        original_filename: f.original_filename,
      };
    }
  }
  const userCanDownload = canWrite(me.role);
  const userCanEdit = canWrite(me.role);

  const baseParams = (overrides: Record<string, string>) => {
    const params: Record<string, string> = {};
    if (yearParam !== 'all') params.year = yearParam;
    if (q) params.q = q;
    if (sort !== 'lg_name') params.sort = sort;
    if (dir !== 'asc') params.dir = dir;
    if (size !== DEFAULT_PAGE_SIZE) params.size = String(size);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === 'all' || !v) delete params[k];
      else params[k] = v;
    }
    return new URLSearchParams(params).toString();
  };

  const pageHref = (p: number) => {
    const params = new URLSearchParams(baseParams({}));
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return qs ? `/maintenance?${qs}` : '/maintenance';
  };

  const sizeHref = (s: number) => {
    const params = new URLSearchParams(baseParams({}));
    params.delete('size');
    if (s !== DEFAULT_PAGE_SIZE) params.set('size', String(s));
    const qs = params.toString();
    return qs ? `/maintenance?${qs}` : '/maintenance';
  };

  const sortLink = (key: MouSortKey): string => {
    const nextDir = sort === key && dir === 'asc' ? 'desc' : 'asc';
    return `/maintenance?${baseParams({ sort: key, dir: nextDir })}`;
  };

  const sortArrow = (key: MouSortKey): string => {
    if (sort !== key) return '';
    return dir === 'asc' ? ' ▲' : ' ▼';
  };

  const sortLinks = {
    lg_name: sortLink('lg_name'),
    status: sortLink('status'),
    signed_date: sortLink('signed_date'),
    effective_expiry: sortLink('effective_expiry'),
    amount_krw: sortLink('amount_krw'),
    updated_at: sortLink('updated_at'),
  } satisfies Record<MouSortKey, string>;

  const sortArrows = {
    lg_name: sortArrow('lg_name'),
    status: sortArrow('status'),
    signed_date: sortArrow('signed_date'),
    effective_expiry: sortArrow('effective_expiry'),
    amount_krw: sortArrow('amount_krw'),
    updated_at: sortArrow('updated_at'),
  } satisfies Record<MouSortKey, string>;

  const fmtKrw = (n: number) => new Intl.NumberFormat('ko-KR').format(n);

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
      >
        <span aria-hidden>←</span> 대시보드
      </Link>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">유지보수 계약</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            매년 재계약 · 모노플랫폼 직접 단일 주체 · 기간 연장 개념 없음 (갱신 착수로 재계약)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canWrite(me.role) && (
            <a
              href={`/api/export/maintenance.xlsx?${baseParams({})}`}
              className="text-sm font-medium px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 rounded"
            >
              📥 엑셀 내보내기
            </a>
          )}
        </div>
      </div>

      {/* 연도별 요약 카드 */}
      {yearSummary.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 mb-2">연도별 계약현황 (계약시작일 기준)</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {yearSummary.map((y) => {
              const isActive = yearParam === y.year;
              return (
                <Link
                  key={y.year}
                  href={`/maintenance?${baseParams({ year: y.year })}`}
                  className={`rounded border px-3 py-2 transition ${
                    isActive
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <p className={`text-sm font-bold ${isActive ? 'text-teal-900' : 'text-slate-900'}`}>
                    {y.year}년
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    <b className="tabular-nums">{y.count}건</b>
                    {y.totalAmount > 0 && (
                      <>
                        {' · '}
                        <b className="tabular-nums">{fmtKrw(y.totalAmount)}원</b>
                      </>
                    )}
                  </p>
                </Link>
              );
            })}
            {availableYears.length > 0 && (
              <Link
                href="/maintenance"
                className={`rounded border px-3 py-2 transition flex flex-col justify-center ${
                  yearParam === 'all'
                    ? 'border-slate-700 bg-slate-100'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <p className={`text-sm font-bold ${yearParam === 'all' ? 'text-slate-900' : 'text-slate-700'}`}>
                  전체
                </p>
                <p className="text-xs text-slate-500 mt-0.5 tabular-nums">{allMou.length}건</p>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* 검색 폼 */}
      <form className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="flex gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="지자체명·담당부서·담당자·연락처·메모 검색"
              className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm"
            />
            {yearParam !== 'all' && <input type="hidden" name="year" value={yearParam} />}
          </div>
          <button
            type="submit"
            className="text-sm px-4 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 rounded"
          >
            검색
          </button>
        </div>
      </form>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          조회 오류: {error.message}
        </p>
      )}

      <MaintenanceTable
        rows={paged}
        fileMap={fileMap}
        userCanDownload={userCanDownload}
        userCanEdit={userCanEdit}
        sortLinks={sortLinks}
        sortArrows={sortArrows}
      />

      {fetchCapped && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          ⚠ 서버 조회 한도({SERVER_FETCH_CAP}건)에 도달했습니다. 연도 필터로 좁히세요.
        </p>
      )}

      {totalEntries > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">
              {yearParam !== 'all' && <b className="text-slate-700">{yearParam}년 · </b>}
              전체 {totalEntries}건 ·{' '}
              <b className="text-slate-700 tabular-nums">{currentPage}</b> / {totalPages} 페이지
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-slate-500">페이지당</span>
              {PAGE_SIZES.map((s) => (
                <Link
                  key={s}
                  href={sizeHref(s)}
                  scroll={false}
                  className={`px-2 py-1 rounded border tabular-nums ${
                    size === s
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {s}
                </Link>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {currentPage > 1 ? (
                <Link
                  href={pageHref(currentPage - 1)}
                  scroll={false}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
                  aria-label="이전 페이지"
                >
                  ‹ 이전
                </Link>
              ) : (
                <span className="px-2.5 py-1 rounded border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed">
                  ‹ 이전
                </span>
              )}
              <span className="px-2 text-slate-500 tabular-nums">
                {currentPage} / {totalPages}
              </span>
              {currentPage < totalPages ? (
                <Link
                  href={pageHref(currentPage + 1)}
                  scroll={false}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
                  aria-label="다음 페이지"
                >
                  다음 ›
                </Link>
              ) : (
                <span className="px-2.5 py-1 rounded border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed">
                  다음 ›
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
