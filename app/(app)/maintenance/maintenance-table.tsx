'use client';

import Link from 'next/link';
import RowPreview from '../contracts/row-preview';
import EditMetaButton from '../contracts/[id]/edit-meta-button';
import {
  fmtDate,
  fmtDateTime,
  effectiveExpiry,
  formatAutoRenewalPeriod,
} from '@/lib/utils';
import { StatusBadge } from '@/app/components/badges';
import type { Database } from '@/lib/types/database';

type Status = Database['public']['Enums']['contract_status'];
type Party = Database['public']['Enums']['contracting_party'];
type Ctype = Database['public']['Enums']['contract_type'];

export type MouRow = {
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
  contact_department: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  local_governments: {
    full_name: string | null;
    sigungu: string | null;
  } | null;
};

export type MouFile = {
  id: string;
  original_filename: string;
};

export type MouSortKey =
  | 'lg_name'
  | 'status'
  | 'effective_date'
  | 'effective_expiry'
  | 'amount_krw'
  | 'updated_at';

export default function MaintenanceTable({
  rows,
  fileMap,
  userCanDownload,
  userCanEdit,
  sortLinks,
  sortArrows,
}: {
  rows: MouRow[];
  fileMap: Record<string, MouFile>;
  userCanDownload: boolean;
  userCanEdit: boolean;
  sortLinks: Record<MouSortKey, string>;
  sortArrows: Record<MouSortKey, string>;
}) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
      <table className="w-full text-sm min-w-[1200px]">
        <thead>
          <tr className="text-xs text-slate-500 bg-slate-50">
            <th className="text-left px-4 py-2 font-medium w-12">No</th>
            <th className="text-left px-4 py-2 font-medium">
              <Link href={sortLinks.lg_name} className="hover:text-slate-900">
                지자체{sortArrows.lg_name}
              </Link>
            </th>
            <th className="text-left px-4 py-2 font-medium">담당부서·담당자</th>
            <th className="text-left px-4 py-2 font-medium">연락처</th>
            <th className="text-left px-4 py-2 font-medium">
              <Link href={sortLinks.status} className="hover:text-slate-900">
                상태{sortArrows.status}
              </Link>
            </th>
            <th className="text-left px-4 py-2 font-medium">
              <Link href={sortLinks.effective_date} className="hover:text-slate-900">
                계약시작일{sortArrows.effective_date}
              </Link>
            </th>
            <th className="text-left px-4 py-2 font-medium">
              <Link href={sortLinks.effective_expiry} className="hover:text-slate-900">
                실효 만료일{sortArrows.effective_expiry}
              </Link>
            </th>
            <th className="text-right px-4 py-2 font-medium">
              <Link href={sortLinks.amount_krw} className="hover:text-slate-900">
                계약금액{sortArrows.amount_krw}
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
          {rows.length === 0 && (
            <tr>
              <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                유지보수 계약이 없습니다.
              </td>
            </tr>
          )}
          {rows.map((c, idx) => {
            const lg = c.local_governments;
            return (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-500 tabular-nums">{idx + 1}</td>
                <td className="px-4 py-2">
                  <Link
                    href={`/contracts/${c.id}`}
                    className="text-slate-900 font-medium hover:text-indigo-600"
                  >
                    {lg?.full_name ?? '-'}
                  </Link>
                </td>
                <td className="px-4 py-2 text-xs text-slate-700">
                  {c.contact_department && (
                    <p className="text-slate-500">{c.contact_department}</p>
                  )}
                  <p>{c.contact_name ?? '-'}</p>
                </td>
                <td className="px-4 py-2 text-xs text-slate-700 tabular-nums">
                  {c.contact_phone && <p>{c.contact_phone}</p>}
                  {c.contact_email && (
                    <p className="text-slate-500 truncate max-w-[180px]" title={c.contact_email}>
                      {c.contact_email}
                    </p>
                  )}
                  {!c.contact_phone && !c.contact_email && '-'}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-4 py-2 tabular-nums">{fmtDate(c.effective_date)}</td>
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
                <td className="px-4 py-2 text-right tabular-nums font-medium">
                  {c.amount_krw != null
                    ? new Intl.NumberFormat('ko-KR').format(c.amount_krw) + '원'
                    : '-'}
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
