'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import RowPreview from './row-preview';
import EditMetaButton from './[id]/edit-meta-button';
import {
  fmtDate,
  fmtDateTime,
  effectiveExpiry,
  formatAutoRenewalPeriod,
} from '@/lib/utils';
import { StatusBadge, TypeBadge, PartyBadge } from '@/app/components/badges';
import type { Database } from '@/lib/types/database';

type Status = Database['public']['Enums']['contract_status'];
type Party = Database['public']['Enums']['contracting_party'];
type Ctype = Database['public']['Enums']['contract_type'];

export type ContractRow = {
  id: string;
  status: Status;
  contract_type: Ctype;
  contracting_party: Party;
  master_contract_id: string | null;
  local_government_id: string;
  signed_date: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  extended_expiry_date: string | null;
  auto_renewal: boolean;
  auto_renewal_period_months: number | null;
  auto_renewal_end_date: string | null;
  amount_krw: number | null;
  memo: string | null;
  version: number;
  updated_at: string;
  local_governments: { full_name: string | null; sigungu: string | null } | null;
};

export type ContractFile = {
  id: string;
  original_filename: string;
};

export type SortKey =
  | 'lg_name'
  | 'type'
  | 'party'
  | 'status'
  | 'signed_date'
  | 'effective_expiry'
  | 'updated_at';

export default function ContractsTable({
  rows,
  fileMap,
  maintenanceMainIds,
  userCanDownload,
  userCanEdit,
  groupByLg,
  sortLinks,
  sortArrows,
}: {
  rows: ContractRow[];
  fileMap: Record<string, ContractFile>;
  /** 메인 행에 "+유지보수" 보조 뱃지를 띄울 메인 ID 목록 — 살아있는 유지보수 부속 보유 메인. */
  maintenanceMainIds: string[];
  userCanDownload: boolean;
  userCanEdit: boolean;
  /** lg_name 정렬 시에만 그루핑 표시 사용. 그 외 정렬에서는 펼치기 비활성. */
  groupByLg: boolean;
  sortLinks: Record<SortKey, string>;
  sortArrows: Record<SortKey, string>;
}) {
  const maintenanceSet = useMemo(
    () => new Set(maintenanceMainIds),
    [maintenanceMainIds],
  );
  // 메인 계약 ID → 부속 ID 배열
  const supplementsByMain = useMemo(() => {
    const map = new Map<string, ContractRow[]>();
    for (const r of rows) {
      if (r.master_contract_id) {
        const list = map.get(r.master_contract_id) ?? [];
        list.push(r);
        map.set(r.master_contract_id, list);
      }
    }
    return map;
  }, [rows]);

  // 기본: 모두 접힘. 사용자가 클릭하면 열림.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(mainId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(mainId)) next.delete(mainId);
      else next.add(mainId);
      return next;
    });
  }

  function expandAll() {
    const all = new Set<string>();
    for (const r of rows) {
      if (!r.master_contract_id && supplementsByMain.has(r.id)) all.add(r.id);
    }
    setExpanded(all);
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  const hasAnySupplements = supplementsByMain.size > 0;

  // 실제 렌더링할 행 — 접힌 메인의 부속은 제외
  const visible: Array<{ row: ContractRow; isSupplement: boolean }> = [];
  for (const r of rows) {
    if (!groupByLg) {
      visible.push({ row: r, isSupplement: !!r.master_contract_id });
      continue;
    }
    if (r.master_contract_id) {
      // 부속 — 메인이 펼쳐져 있을 때만 표시
      if (expanded.has(r.master_contract_id)) {
        visible.push({ row: r, isSupplement: true });
      }
    } else {
      visible.push({ row: r, isSupplement: false });
    }
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
      {groupByLg && hasAnySupplements && (
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 text-xs text-slate-600">
          <span>부속 계약 표시:</span>
          <button
            type="button"
            onClick={expandAll}
            className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
          >
            전부 펼치기
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
          >
            전부 접기
          </button>
        </div>
      )}
      <table className="w-full text-sm min-w-[900px]">
        <thead>
          <tr className="text-xs text-slate-500 bg-slate-50">
            <th className="text-left px-4 py-2 font-medium w-12">No</th>
            <th className="text-left px-4 py-2 font-medium">
              <Link href={sortLinks.lg_name} className="hover:text-slate-900">
                지자체{sortArrows.lg_name}
              </Link>
            </th>
            <th className="text-left px-4 py-2 font-medium">
              <Link href={sortLinks.type} className="hover:text-slate-900">
                유형{sortArrows.type}
              </Link>
            </th>
            <th className="text-left px-4 py-2 font-medium">
              <Link href={sortLinks.party} className="hover:text-slate-900">
                주체{sortArrows.party}
              </Link>
            </th>
            <th className="text-left px-4 py-2 font-medium">
              <Link href={sortLinks.status} className="hover:text-slate-900">
                상태{sortArrows.status}
              </Link>
            </th>
            <th className="text-left px-4 py-2 font-medium">
              <Link href={sortLinks.signed_date} className="hover:text-slate-900">
                체결일{sortArrows.signed_date}
              </Link>
            </th>
            <th className="text-left px-4 py-2 font-medium">
              <Link
                href={sortLinks.effective_expiry}
                className="hover:text-slate-900"
              >
                실효 만료일{sortArrows.effective_expiry}
              </Link>
            </th>
            <th className="text-left px-4 py-2 font-medium">
              <Link href={sortLinks.updated_at} className="hover:text-slate-900">
                최종 수정{sortArrows.updated_at}
              </Link>
            </th>
            <th className="text-right px-4 py-2 font-medium">수정</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                계약이 없습니다.
              </td>
            </tr>
          )}
          {visible.map((entry, idx) => {
            const c = entry.row;
            const isSupplement = entry.isSupplement;
            const supplementsOfThisMain = supplementsByMain.get(c.id) ?? [];
            const hasSupplements = !isSupplement && supplementsOfThisMain.length > 0;
            const isExpanded = expanded.has(c.id);
            return (
              <tr
                key={c.id}
                className={`border-t border-slate-100 hover:bg-slate-50 ${isSupplement ? 'bg-slate-50/50' : ''}`}
              >
                <td className="px-4 py-2 text-slate-500 tabular-nums">{idx + 1}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1.5">
                    {groupByLg && hasSupplements ? (
                      <button
                        type="button"
                        onClick={() => toggle(c.id)}
                        aria-label={isExpanded ? '부속 접기' : '부속 펼치기'}
                        aria-expanded={isExpanded}
                        title={`부속 ${supplementsOfThisMain.length}건 ${isExpanded ? '접기' : '펼치기'}`}
                        className="inline-flex items-center justify-center w-5 h-5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs leading-none tabular-nums"
                      >
                        {isExpanded ? '−' : '+'}
                      </button>
                    ) : (
                      <span className="inline-block w-5" aria-hidden />
                    )}
                    <Link
                      href={`/contracts/${c.id}`}
                      className={`hover:text-indigo-600 ${
                        isSupplement
                          ? 'text-slate-400 pl-3'
                          : 'text-slate-900 font-medium'
                      }`}
                    >
                      {isSupplement ? '└' : ''} {c.local_governments?.full_name ?? '-'}
                      {hasSupplements && (
                        <span className="text-[11px] text-slate-400 ml-1.5">
                          ·부속 {supplementsOfThisMain.length}
                        </span>
                      )}
                    </Link>
                  </div>
                </td>
                <td className="px-4 py-2">
                  <div className="inline-flex items-center gap-1 flex-wrap">
                    <TypeBadge ctype={c.contract_type} isSupplement={isSupplement} />
                    {!isSupplement && maintenanceSet.has(c.id) && (
                      <span
                        className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ring-1 ring-inset ring-teal-200 bg-teal-50 text-teal-800"
                        title="유지보수 부속 계약 보유"
                      >
                        + 유지보수
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <PartyBadge party={c.contracting_party} />
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-4 py-2 tabular-nums">{fmtDate(c.signed_date)}</td>
                <td className="px-4 py-2 tabular-nums">
                  <div className="flex items-center gap-1.5">
                    <span>{fmtDate(effectiveExpiry(c))}</span>
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
                <td className="px-4 py-2 text-slate-600 text-xs">
                  {fmtDateTime(c.updated_at)}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="inline-flex items-center gap-1">
                    <RowPreview
                      file={fileMap[c.id] ?? null}
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
                          auto_renewal: c.auto_renewal,
                          auto_renewal_period_months: c.auto_renewal_period_months,
                          auto_renewal_end_date: c.auto_renewal_end_date,
                          amount_krw: c.amount_krw,
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
  );
}
