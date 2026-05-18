import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import ZipMenu from './zip-menu';
import RowPreview from './row-preview';
import {
  STATUS_LABEL,
  STATUS_BADGE,
  PARTY_LABEL,
  PARTY_BADGE,
  TYPE_LABEL,
  TYPE_BADGE,
  fmtDate,
  fmtDateTime,
  canWrite,
  effectiveExpiry,
} from '@/lib/utils';
import type { Database } from '@/lib/types/database';
import EditMetaButton from './[id]/edit-meta-button';

export const dynamic = 'force-dynamic';

type Status = Database['public']['Enums']['contract_status'];
type Party = Database['public']['Enums']['contracting_party'];
type Ctype = Database['public']['Enums']['contract_type'];

const STATUS_FILTERS: { key: Status | 'all'; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'in_progress', label: '체결중' },
  { key: 'completed', label: '계약완료' },
  { key: 'updating', label: '갱신중' },
  { key: 'terminated', label: '종료' },
];

const TYPE_FILTERS: { key: Ctype | 'all'; label: string }[] = [
  { key: 'all', label: '전체 유형' },
  { key: 'parking_enforcement', label: '주차단속(메인)' },
  { key: 'personal_info_outsourcing', label: '개인정보' },
  { key: 'mou', label: 'MOU' },
  { key: 'other', label: '기타' },
];

const PARTY_FILTERS: { key: Party | 'all'; label: string }[] = [
  { key: 'all', label: '전체 주체' },
  { key: 'monoplatform', label: '모노플랫폼' },
  { key: 'imcity', label: '아이엠시티' },
];

export default async function ContractsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; type?: string; party?: string }>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const status = (sp.status ?? 'all') as Status | 'all';
  const type = (sp.type ?? 'all') as Ctype | 'all';
  const party = (sp.party ?? 'all') as Party | 'all';
  const q = (sp.q ?? '').trim();

  const supabase = await createClient();
  let query = supabase
    .from('contracts')
    .select(
      'id, status, signed_date, effective_date, expiry_date, extended_expiry_date, memo, version, contract_type, contracting_party, master_contract_id, local_government_id, updated_at, local_governments(full_name, sigungu)',
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

  // 각 계약의 최신 파일을 한 번에 조회 → contract_id → file 매핑
  const contractIds = filtered.map((c) => c.id);
  const fileMap = new Map<
    string,
    { storage_path: string; original_filename: string }
  >();
  if (contractIds.length > 0) {
    const { data: files } = await supabase
      .from('contract_files')
      .select('contract_id, storage_path, original_filename')
      .in('contract_id', contractIds)
      .eq('is_latest', true)
      .is('deleted_at', null);
    for (const f of files ?? []) {
      fileMap.set(f.contract_id, {
        storage_path: f.storage_path,
        original_filename: f.original_filename,
      });
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
    for (const [k, v] of Object.entries(overrides)) {
      if (v === 'all' || !v) delete params[k];
      else params[k] = v;
    }
    return new URLSearchParams(params).toString();
  };

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

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 bg-slate-50">
              <th className="text-left px-4 py-2 font-medium">지자체</th>
              <th className="text-left px-4 py-2 font-medium">유형</th>
              <th className="text-left px-4 py-2 font-medium">주체</th>
              <th className="text-left px-4 py-2 font-medium">상태</th>
              <th className="text-left px-4 py-2 font-medium">체결일</th>
              <th className="text-left px-4 py-2 font-medium">실효 만료일</th>
              <th className="text-left px-4 py-2 font-medium">최종 수정</th>
              <th className="text-right px-4 py-2 font-medium">동작</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  계약이 없습니다.
                </td>
              </tr>
            )}
            {filtered.map((c, idx) => {
              const prev = idx > 0 ? filtered[idx - 1] : null;
              const sameLg = prev && prev.local_government_id === c.local_government_id;
              const isSupplement = !!c.master_contract_id;
              return (
                <tr
                  key={c.id}
                  className={`border-t border-slate-100 hover:bg-slate-50 ${sameLg ? 'bg-slate-50/50' : ''}`}
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/contracts/${c.id}`}
                      className={`hover:text-indigo-600 ${sameLg ? 'text-slate-400 pl-4' : 'text-slate-900 font-medium'}`}
                    >
                      {sameLg ? '└' : ''} {c.local_governments?.full_name ?? '-'}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded ring-1 ring-inset ${TYPE_BADGE[c.contract_type]}`}>
                      {TYPE_LABEL[c.contract_type]}
                      {isSupplement ? '·부속' : '·메인'}
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
                  <td className="px-4 py-2 tabular-nums">{fmtDate(c.signed_date)}</td>
                  <td className="px-4 py-2 tabular-nums">{fmtDate(effectiveExpiry(c))}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">{fmtDateTime(c.updated_at)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <RowPreview
                        file={fileMap.get(c.id) ?? null}
                        canDownload={userCanDownload}
                      />
                      {userCanEdit && (
                        <EditMetaButton
                          variant="icon"
                          contract={{
                            id: c.id,
                            version: c.version,
                            local_government_id: c.local_government_id,
                            signed_date: c.signed_date,
                            effective_date: c.effective_date,
                            expiry_date: c.expiry_date,
                            extended_expiry_date: c.extended_expiry_date,
                            memo: c.memo,
                            contract_type: c.contract_type,
                            contracting_party: c.contracting_party,
                            master_contract_id: c.master_contract_id,
                          }}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
