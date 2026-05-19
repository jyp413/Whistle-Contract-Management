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
    .limit(200);

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

  // 각 계약의 최신 파일을 한 번에 조회 → contract_id → file 매핑
  const contractIds = filtered.map((c) => c.id);
  const fileMap: Record<
    string,
    { id: string; original_filename: string }
  > = {};
  if (contractIds.length > 0) {
    const { data: files } = await supabase
      .from('contract_files')
      .select('contract_id, id, original_filename')
      .in('contract_id', contractIds)
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
    if (status !== 'all') params.status = status;
    if (type !== 'all') params.type = type;
    if (party !== 'all') params.party = party;
    if (q) params.q = q;
    if (sort !== 'lg_name') params.sort = sort;
    if (dir !== 'asc') params.dir = dir;
    for (const [k, v] of Object.entries(overrides)) {
      if (v === 'all' || !v) delete params[k];
      else params[k] = v;
    }
    return new URLSearchParams(params).toString();
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
        rows={filtered}
        fileMap={fileMap}
        userCanDownload={userCanDownload}
        userCanEdit={userCanEdit}
        groupByLg={sort === 'lg_name'}
        sortLinks={sortLinks}
        sortArrows={sortArrows}
      />
    </div>
  );
}
