import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import ZipMenu from './zip-menu';
import ContractsTable, { type SortKey } from './contracts-table';
import {
  canWrite,
  effectiveExpiry,
  STATUS_LABEL,
  TYPE_LABEL,
  PARTY_LABEL,
} from '@/lib/utils';
import type { Database } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

type Status = Database['public']['Enums']['contract_status'];
type Party = Database['public']['Enums']['contracting_party'];
type Ctype = Database['public']['Enums']['contract_type'];

// 필터 라벨은 STATUS_LABEL/TYPE_LABEL/PARTY_LABEL 에서 도출 — 디테일 뱃지와 1:1 매칭 유지
const STATUS_FILTERS: { key: Status | 'all'; label: string }[] = [
  { key: 'all', label: '전체' },
  ...(Object.entries(STATUS_LABEL) as [Status, string][]).map(([key, label]) => ({
    key,
    label,
  })),
];

const TYPE_FILTERS: { key: Ctype | 'all'; label: string }[] = [
  { key: 'all', label: '전체 유형' },
  ...(Object.entries(TYPE_LABEL) as [Ctype, string][]).map(([key, label]) => ({
    key,
    label: key === 'parking_enforcement' ? `${label} (메인)` : label,
  })),
];

const PARTY_FILTERS: { key: Party | 'all'; label: string }[] = [
  { key: 'all', label: '전체 주체' },
  ...(Object.entries(PARTY_LABEL) as [Party, string][]).map(([key, label]) => ({
    key,
    label,
  })),
];

const SORT_KEYS: ReadonlyArray<SortKey> = [
  'lg_name',
  'type',
  'party',
  'status',
  'signed_date',
  'effective_expiry',
  'updated_at',
];

const PAGE_SIZES = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 10;
const SERVER_FETCH_CAP = 500;

export default async function ContractsListPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    type?: string;
    party?: string;
    sort?: string;
    dir?: string;
    page?: string;
    size?: string;
  }>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const status = (sp.status ?? 'all') as Status | 'all';
  const type = (sp.type ?? 'all') as Ctype | 'all';
  const party = (sp.party ?? 'all') as Party | 'all';
  const q = (sp.q ?? '').trim();
  const sort: SortKey = (SORT_KEYS as readonly string[]).includes(sp.sort ?? '')
    ? (sp.sort as SortKey)
    : 'lg_name';
  const dir: 'asc' | 'desc' = sp.dir === 'desc' ? 'desc' : 'asc';
  const sizeRaw = parseInt(sp.size ?? '', 10);
  const size: (typeof PAGE_SIZES)[number] = (PAGE_SIZES as readonly number[]).includes(sizeRaw)
    ? (sizeRaw as (typeof PAGE_SIZES)[number])
    : DEFAULT_PAGE_SIZE;
  const pageRaw = parseInt(sp.page ?? '1', 10);
  const requestedPage = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const supabase = await createClient();
  let query = supabase
    .from('contracts')
    .select(
      'id, status, signed_date, effective_date, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date, memo, version, contract_type, contracting_party, master_contract_id, local_government_id, updated_at, local_governments(full_name, sigungu)',
    )
    .is('deleted_at', null)
    .order('local_government_id', { ascending: true })
    .order('master_contract_id', { ascending: true, nullsFirst: true })
    .order('updated_at', { ascending: false })
    .limit(SERVER_FETCH_CAP);

  if (status !== 'all') {
    query = query.eq('status', status);
  }
  if (type !== 'all') {
    query = query.eq('contract_type', type);
  }
  if (party !== 'all') {
    query = query.eq('contracting_party', party);
  }

  const { data: contracts, error } = await query;

  let filtered = contracts ?? [];
  if (q) {
    const needle = q.toLowerCase();
    filtered = filtered.filter((c) =>
      (c.local_governments?.full_name ?? '').toLowerCase().includes(needle),
    );
  }

  // 클라이언트 측 정렬 (Server Component이지만 응답 받은 후 정렬)
  const sortBy = (a: typeof filtered[number], b: typeof filtered[number]): number => {
    let av: string | number | null = null;
    let bv: string | number | null = null;
    switch (sort) {
      case 'lg_name':
        av = a.local_governments?.full_name ?? '';
        bv = b.local_governments?.full_name ?? '';
        break;
      case 'type':
        av = a.contract_type;
        bv = b.contract_type;
        break;
      case 'party':
        av = a.contracting_party;
        bv = b.contracting_party;
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

  // 페이지네이션 — 그루핑 모드(sort=lg_name)에서는 메인 단위로 페이지를 자르고
  // 페이지에 들어간 메인의 부속들은 같은 페이지에 함께 포함시킨다 (페이지 경계로 분리되지 않게).
  const groupByLg = sort === 'lg_name';
  let totalEntries: number;
  let paged: typeof filtered;

  if (groupByLg) {
    const mains = filtered.filter((c) => !c.master_contract_id);
    const suppsByMain = new Map<string, typeof filtered>();
    for (const c of filtered) {
      if (!c.master_contract_id) continue;
      const arr = suppsByMain.get(c.master_contract_id) ?? [];
      arr.push(c);
      suppsByMain.set(c.master_contract_id, arr);
    }
    totalEntries = mains.length;
    const totalPagesCalc = Math.max(1, Math.ceil(totalEntries / size));
    const page = Math.min(Math.max(1, requestedPage), totalPagesCalc);
    const start = (page - 1) * size;
    const pageMains = mains.slice(start, start + size);
    paged = [];
    for (const m of pageMains) {
      paged.push(m);
      paged.push(...(suppsByMain.get(m.id) ?? []));
    }
  } else {
    totalEntries = filtered.length;
    const totalPagesCalc = Math.max(1, Math.ceil(totalEntries / size));
    const page = Math.min(Math.max(1, requestedPage), totalPagesCalc);
    const start = (page - 1) * size;
    paged = filtered.slice(start, start + size);
  }

  const totalPages = Math.max(1, Math.ceil(totalEntries / size));
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
  const fetchCapped = (contracts?.length ?? 0) >= SERVER_FETCH_CAP;

  // 파일 매핑 — 현재 페이지에 표시될 행만 조회
  const visibleIds = paged.map((c) => c.id);
  const fileMap: Record<
    string,
    { id: string; original_filename: string }
  > = {};
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

  // 필터/정렬 변경 시 page 는 1 로 reset (querystring 에서 제외). size 는 사용자 선호로 유지.
  const baseParams = (overrides: Record<string, string>) => {
    const params: Record<string, string> = {};
    if (status !== 'all') params.status = status;
    if (type !== 'all') params.type = type;
    if (party !== 'all') params.party = party;
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

  // 페이지 네비게이션 — 필터/정렬/사이즈 유지, page 만 변경
  const pageHref = (p: number) => {
    const params = new URLSearchParams(baseParams({}));
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return qs ? `/contracts?${qs}` : '/contracts';
  };

  // 페이지 사이즈 변경 — page=1 로 reset
  const sizeHref = (s: number) => {
    const params = new URLSearchParams(baseParams({}));
    params.delete('size');
    if (s !== DEFAULT_PAGE_SIZE) params.set('size', String(s));
    const qs = params.toString();
    return qs ? `/contracts?${qs}` : '/contracts';
  };

  const sortLink = (key: SortKey): string => {
    const nextDir = sort === key && dir === 'asc' ? 'desc' : 'asc';
    return `/contracts?${baseParams({ sort: key, dir: nextDir })}`;
  };

  const sortArrow = (key: SortKey): string => {
    if (sort !== key) return '';
    return dir === 'asc' ? ' ▲' : ' ▼';
  };

  const sortLinks = {
    lg_name: sortLink('lg_name'),
    type: sortLink('type'),
    party: sortLink('party'),
    status: sortLink('status'),
    signed_date: sortLink('signed_date'),
    effective_expiry: sortLink('effective_expiry'),
    updated_at: sortLink('updated_at'),
  } satisfies Record<SortKey, string>;

  const sortArrows = {
    lg_name: sortArrow('lg_name'),
    type: sortArrow('type'),
    party: sortArrow('party'),
    status: sortArrow('status'),
    signed_date: sortArrow('signed_date'),
    effective_expiry: sortArrow('effective_expiry'),
    updated_at: sortArrow('updated_at'),
  } satisfies Record<SortKey, string>;

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
      >
        <span aria-hidden>←</span> 대시보드
      </Link>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">계약 목록</h1>
        <div className="flex items-center gap-2">
          {canWrite(me.role) && (
            <>
              <a
                href={`/api/export/contracts.xlsx?${baseParams({})}`}
                className="text-sm font-medium px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 rounded"
              >
                엑셀 내보내기
              </a>
              <ZipMenu status={status} type={type} party={party} q={q} />
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

      <form className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
        <div className="flex flex-wrap gap-1">
          <span className="text-xs text-slate-500 self-center pr-1">상태</span>
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/contracts?${baseParams({ status: f.key })}`}
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
        <div className="flex flex-wrap gap-1">
          <span className="text-xs text-slate-500 self-center pr-1">유형</span>
          {TYPE_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/contracts?${baseParams({ type: f.key })}`}
              className={`text-xs px-3 py-1.5 rounded border ${
                type === f.key
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <span className="text-xs text-slate-500 self-center pr-1">주체</span>
          {PARTY_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/contracts?${baseParams({ party: f.key })}`}
              className={`text-xs px-3 py-1.5 rounded border ${
                party === f.key
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="지자체명 검색"
              className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm"
            />
            {status !== 'all' && <input type="hidden" name="status" value={status} />}
            {type !== 'all' && <input type="hidden" name="type" value={type} />}
            {party !== 'all' && <input type="hidden" name="party" value={party} />}
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

      <ContractsTable
        rows={paged}
        fileMap={fileMap}
        userCanDownload={userCanDownload}
        userCanEdit={userCanEdit}
        groupByLg={groupByLg}
        sortLinks={sortLinks}
        sortArrows={sortArrows}
      />

      {fetchCapped && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          ⚠ 서버 조회 한도({SERVER_FETCH_CAP}건)에 도달했습니다. 필터를 좁히면 정확한 페이지네이션이 가능합니다.
        </p>
      )}

      {/* 페이지네이션 — 1건 이상이면 항상 표시 */}
      {totalEntries > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">
              {groupByLg ? '메인' : '전체'} {totalEntries}건 ·{' '}
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
