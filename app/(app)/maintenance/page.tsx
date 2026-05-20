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
  'effective_date',
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
      'id, status, signed_date, effective_date, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date, amount_krw, memo, version, contract_type, contracting_party, master_contract_id, local_government_id, updated_at, contact_department, contact_name, contact_phone, contact_email, local_governments(full_name, sigungu)',
    )
    .eq('contract_type', 'mou')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(SERVER_FETCH_CAP);

  const allMou = contracts ?? [];

  // 연도별 요약 — 용역 제공 연도 기준 = 실효 만료일(effectiveExpiry)의 연도.
  // 체결일이 전년도 말(예: 2025-12)이라도 계약기간이 2026년이면 2026년 용역으로 집계.
  // mou는 연장/자동연장 없음 → effectiveExpiry = expiry_date.
  const mouYear = (c: (typeof allMou)[number]): string | null =>
    effectiveExpiry(c)?.slice(0, 4) ?? null;
  const yearSummaryMap = new Map<string, { count: number; totalAmount: number }>();
  for (const c of allMou) {
    const y = mouYear(c);
    if (!y) continue;
    const entry = yearSummaryMap.get(y) ?? { count: 0, totalAmount: 0 };
    entry.count += 1;
    if (c.amount_krw != null) entry.totalAmount += c.amount_krw;
    yearSummaryMap.set(y, entry);
  }
  const availableYears = Array.from(yearSummaryMap.keys()).sort((a, b) => (a < b ? 1 : -1));

  // 선택 연도의 요약 (드랍다운 옆 inline 표시용)
  const selectedYearSummary =
    yearParam !== 'all' ? yearSummaryMap.get(yearParam) ?? null : null;
  const allSummary = {
    count: allMou.length,
    totalAmount: allMou.reduce((sum, c) => sum + (c.amount_krw ?? 0), 0),
  };

  // 연도 필터 적용 (용역 제공 연도 = effectiveExpiry 기준)
  let filtered = allMou;
  if (yearParam !== 'all') {
    filtered = filtered.filter((c) => mouYear(c) === yearParam);
  }

  // 검색 필터 — column-wise ilike (보안: .or() DSL 금지)
  if (q) {
    const needle = q.toLowerCase();
    filtered = filtered.filter((c) => {
      const lg = c.local_governments;
      return (
        (lg?.full_name ?? '').toLowerCase().includes(needle) ||
        (c.contact_department ?? '').toLowerCase().includes(needle) ||
        (c.contact_name ?? '').toLowerCase().includes(needle) ||
        (c.contact_phone ?? '').toLowerCase().includes(needle) ||
        (c.contact_email ?? '').toLowerCase().includes(needle) ||
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
      case 'effective_date':
        av = a.effective_date ?? '';
        bv = b.effective_date ?? '';
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
    effective_date: sortLink('effective_date'),
    effective_expiry: sortLink('effective_expiry'),
    amount_krw: sortLink('amount_krw'),
    updated_at: sortLink('updated_at'),
  } satisfies Record<MouSortKey, string>;

  const sortArrows = {
    lg_name: sortArrow('lg_name'),
    status: sortArrow('status'),
    effective_date: sortArrow('effective_date'),
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

      {/* 연도 드랍다운 + 선택 연도 요약 + 검색 */}
      <form className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs font-medium text-slate-700">용역 연도</label>
          <select
            name="year"
            defaultValue={yearParam}
            className="px-3 py-1.5 border border-slate-300 rounded text-sm bg-white tabular-nums"
          >
            <option value="all">전체</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          {/* 선택 연도의 요약 — inline 표시 */}
          <div className="text-xs text-slate-600 tabular-nums">
            {yearParam !== 'all' && selectedYearSummary ? (
              <>
                <b className="text-slate-900">{yearParam}년 용역</b>:{' '}
                <b>{selectedYearSummary.count}건</b>
                {selectedYearSummary.totalAmount > 0 && (
                  <> · 총 <b>{fmtKrw(selectedYearSummary.totalAmount)}원</b></>
                )}
              </>
            ) : yearParam !== 'all' ? (
              <span className="text-slate-400">{yearParam}년 용역: 0건</span>
            ) : (
              <>
                <b className="text-slate-900">전체</b>: <b>{allSummary.count}건</b>
                {allSummary.totalAmount > 0 && (
                  <> · 총 <b>{fmtKrw(allSummary.totalAmount)}원</b></>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="지자체명·담당부서·담당자·연락처·메모 검색"
              className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm"
            />
          </div>
          <button
            type="submit"
            className="text-sm px-4 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 rounded"
          >
            적용
          </button>
        </div>
        {allMou.length === 0 && (
          <p className="text-xs text-slate-400 pt-2">
            아직 등록된 유지보수 계약이 없습니다.{' '}
            <Link href="/contracts/new" className="text-indigo-600 hover:underline">
              계약 등록
            </Link>{' '}
            메뉴에서 <b>유지보수</b> 부속을 체크해 등록하세요.
          </p>
        )}
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
