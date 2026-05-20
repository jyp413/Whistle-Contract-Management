import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import {
  STATUS_LABEL,
  fmtDate,
  fmtDateTime,
  canWrite,
  effectiveExpiry,
  formatAutoRenewalPeriod,
  autoRenewalHistory,
} from '@/lib/utils';
import { StatusBadge, TypeBadge, PartyBadge } from '@/app/components/badges';
import UploadCard from './upload-card';
import ContractActions from './contract-actions';
import FilePreviewButton from './file-preview';
import EditMetaButton from './edit-meta-button';
import FileDeleteButton from './file-delete-button';
import ContactCard from './contact-card';
import SupplementCard, { type SupplementInfo } from './supplement-card';

export const dynamic = 'force-dynamic';

const TRANSITION_LABEL: Record<string, string> = {
  create: '신규 등록',
  file_upload_confirm: '파일 업로드 + 확인',
  extend: '계약기간 연장',
  renew_start: '갱신 착수',
  terminate: '종료 처리',
  correction: '상태 보정',
};

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  const { id } = await params;
  const supabase = await createClient();

  const { data: contract, error } = await supabase
    .from('contracts')
    .select(
      'id, status, signed_date, effective_date, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date, amount_krw, contact_department, contact_name, contact_phone, contact_email, termination_reason, memo, version, parent_contract_id, master_contract_id, contract_type, contracting_party, local_government_id, created_at, updated_at, local_governments(full_name, sigungu, classification)',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    return (
      <p className="text-sm text-red-600">조회 오류: {error.message}</p>
    );
  }
  if (!contract) {
    notFound();
  }

  const isMain = !contract.master_contract_id;

  const [
    { data: files },
    { data: history },
    { data: extensions },
    { data: supplements },
  ] = await Promise.all([
    supabase
      .from('contract_files')
      .select(
        'id, original_filename, file_size_bytes, version_no, is_latest, uploaded_at, storage_path',
      )
      .eq('contract_id', id)
      .is('deleted_at', null)
      .order('version_no', { ascending: false }),
    supabase
      .from('contract_status_history')
      .select(
        'id, from_status, to_status, transition_type, reason, is_correction, changed_at, trigger_event',
      )
      .eq('contract_id', id)
      .order('changed_at', { ascending: false }),
    supabase
      .from('contract_extensions')
      .select('id, previous_expiry_date, new_expiry_date, reason, extended_at')
      .eq('contract_id', id)
      .order('extended_at', { ascending: false }),
    isMain
      ? supabase
          .from('contracts')
          .select(
            'id, status, version, contract_type, signed_date, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date, amount_krw',
          )
          .eq('master_contract_id', id)
          .is('deleted_at', null)
          .order('contract_type', { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
  ]);

  // 부속들의 최신 파일을 한 번에 조회
  const supplementInfos: SupplementInfo[] = [];
  if (supplements && supplements.length > 0) {
    const supIds = supplements.map((s) => s.id);
    const { data: supFiles } = await supabase
      .from('contract_files')
      .select(
        'contract_id, id, storage_path, original_filename, version_no, file_size_bytes, uploaded_at',
      )
      .in('contract_id', supIds)
      .eq('is_latest', true)
      .is('deleted_at', null);
    const fileByContract = new Map<string, SupplementInfo['latest_file']>();
    for (const f of supFiles ?? []) {
      fileByContract.set(f.contract_id, {
        id: f.id,
        storage_path: f.storage_path,
        original_filename: f.original_filename,
        version_no: f.version_no,
        file_size_bytes: f.file_size_bytes,
        uploaded_at: f.uploaded_at,
      });
    }
    for (const s of supplements) {
      supplementInfos.push({
        id: s.id,
        status: s.status,
        version: s.version,
        contract_type: s.contract_type,
        signed_date: s.signed_date,
        expiry_date: s.expiry_date,
        extended_expiry_date: s.extended_expiry_date,
        auto_renewal: s.auto_renewal,
        auto_renewal_period_months: s.auto_renewal_period_months,
        auto_renewal_end_date: s.auto_renewal_end_date,
        amount_krw: s.amount_krw,
        latest_file: fileByContract.get(s.id) ?? null,
      });
    }
  }

  const hasFiles = (files?.length ?? 0) > 0;
  const writer = canWrite(me.role);
  // 살아있는 부속 (terminated 제외) — cascade/stale 경고용
  const aliveSupplementCount = supplementInfos.filter(
    (s) => s.status !== 'terminated',
  ).length;

  // 연장 이력 = 실제 수동 연장 기록 + 계산된 자동연장 주기를 만료일 기준 병합
  const autoRows = autoRenewalHistory(contract);
  type ExtRow =
    | {
        kind: 'manual';
        id: string;
        previousExpiry: string | null;
        newExpiry: string | null;
        reason: string | null;
        at: string;
      }
    | { kind: 'auto'; previousExpiry: string; newExpiry: string };
  const extensionRows: ExtRow[] = [
    ...(extensions ?? []).map(
      (e): ExtRow => ({
        kind: 'manual',
        id: e.id,
        previousExpiry: e.previous_expiry_date,
        newExpiry: e.new_expiry_date,
        reason: e.reason,
        at: e.extended_at,
      }),
    ),
    ...autoRows.map(
      (r): ExtRow => ({
        kind: 'auto',
        previousExpiry: r.previousExpiry,
        newExpiry: r.newExpiry,
      }),
    ),
  ].sort((a, b) => (b.newExpiry ?? '').localeCompare(a.newExpiry ?? ''));

  return (
    <div className="space-y-5">
      <Link
        href="/contracts"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
      >
        <span aria-hidden>←</span> 계약 목록
      </Link>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs text-slate-500">
            <Link href="/contracts" className="hover:underline">
              계약 목록
            </Link>
            {' '}/{' '}
            <span className="text-slate-700">계약 상세</span>
          </p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <h1 className="text-xl font-bold text-slate-900">
              {contract.local_governments?.full_name}
            </h1>
            <StatusBadge status={contract.status} size="md" />
            <TypeBadge ctype={contract.contract_type} isSupplement={!!contract.master_contract_id} />
            <PartyBadge party={contract.contracting_party} />
          </div>
          {contract.master_contract_id && (
            <p className="text-xs text-slate-500 mt-1">
              ⌬ 부속 계약 (메인:{' '}
              <Link href={`/contracts/${contract.master_contract_id}`} className="text-indigo-600 hover:underline font-mono">
                {contract.master_contract_id.slice(0, 8)}…
              </Link>
              )
            </p>
          )}
          {contract.parent_contract_id && (
            <p className="text-xs text-slate-500 mt-1">
              ↻ 갱신 계약 (부모:{' '}
              <Link
                href={`/contracts/${contract.parent_contract_id}`}
                className="text-indigo-600 hover:underline font-mono"
              >
                {contract.parent_contract_id.slice(0, 8)}…
              </Link>
              )
            </p>
          )}
        </div>
        <div className="flex items-start gap-2 flex-wrap">
          {writer && (
            <EditMetaButton
              supplementCount={aliveSupplementCount}
              contract={{
                id: contract.id,
                version: contract.version,
                local_government_id: contract.local_government_id,
                signed_date: contract.signed_date,
                effective_date: contract.effective_date,
                expiry_date: contract.expiry_date,
                extended_expiry_date: contract.extended_expiry_date,
                memo: contract.memo,
                contract_type: contract.contract_type,
                contracting_party: contract.contracting_party,
                master_contract_id: contract.master_contract_id,
                auto_renewal: contract.auto_renewal,
                auto_renewal_period_months: contract.auto_renewal_period_months,
                auto_renewal_end_date: contract.auto_renewal_end_date,
                amount_krw: contract.amount_krw,
              }}
            />
          )}
          <ContractActions
            contractId={contract.id}
            status={contract.status}
            contractType={contract.contract_type}
            version={contract.version}
            effectiveExpiry={effectiveExpiry(contract)}
            autoRenewal={
              contract.auto_renewal && contract.auto_renewal_period_months
                ? {
                    periodMonths: contract.auto_renewal_period_months,
                    endDate: contract.auto_renewal_end_date,
                  }
                : null
            }
            renewPrefill={{
              signedDate: contract.signed_date,
              effectiveDate: contract.effective_date,
              expiryDate: effectiveExpiry(contract),
              amountKrw: contract.amount_krw,
            }}
            history={(history ?? []).map((h) => ({
              id: h.id,
              from_status: h.from_status,
              to_status: h.to_status,
              transition_type: h.transition_type,
              is_correction: h.is_correction,
              changed_at: h.changed_at,
            }))}
            userRole={me.role}
            parentContractId={contract.parent_contract_id}
            supplementCount={aliveSupplementCount}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
        <section className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">
            계약 정보
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Row label="계약체결일">{fmtDate(contract.signed_date)}</Row>
            <Row label="계약시작일">{fmtDate(contract.effective_date)}</Row>
            <Row label="계약만료일">{fmtDate(contract.expiry_date)}</Row>
            <Row label="연장 후 만료일">
              {fmtDate(contract.extended_expiry_date)}
            </Row>
            <Row label="자동연장">
              {contract.auto_renewal ? (
                <span className="inline-flex items-center gap-1 text-orange-700 font-medium">
                  🔄 {formatAutoRenewalPeriod(contract.auto_renewal_period_months)}
                  {contract.auto_renewal_end_date && (
                    <span className="text-xs text-slate-500 font-normal">
                      (최대 {fmtDate(contract.auto_renewal_end_date)})
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-slate-400">없음</span>
              )}
            </Row>
            <Row label="실효 만료일">
              <span className="font-semibold">
                {fmtDate(effectiveExpiry(contract))}
              </span>
            </Row>
            {contract.contract_type === 'mou' && (
              <Row label="계약금액 (KRW)">
                {contract.amount_krw != null ? (
                  <span className="font-semibold tabular-nums">
                    {new Intl.NumberFormat('ko-KR').format(contract.amount_krw)}원
                  </span>
                ) : (
                  <span className="text-slate-400">-</span>
                )}
              </Row>
            )}
            <Row label="버전 (낙관락)">v{contract.version}</Row>
            {contract.termination_reason && (
              <Row label="종료 사유" full>
                {contract.termination_reason}
              </Row>
            )}
            {contract.memo && (
              <Row label="비고" full>
                <span className="whitespace-pre-line">{contract.memo}</span>
              </Row>
            )}
          </dl>
          <p className="text-xs text-slate-400 mt-4">
            등록 {fmtDateTime(contract.created_at)} · 최종 수정{' '}
            {fmtDateTime(contract.updated_at)}
          </p>
        </section>

        <ContactCard
          contractId={contract.id}
          initial={{
            contact_department: contract.contact_department,
            contact_name: contract.contact_name,
            contact_phone: contract.contact_phone,
            contact_email: contract.contact_email,
          }}
          canEdit={writer}
        />
        </div>

        <div className="space-y-4">
          {writer ? (
            <UploadCard
              contractId={contract.id}
              currentStatus={contract.status}
              currentVersion={contract.version}
              existingFileCount={files?.length ?? 0}
            />
          ) : (
            <aside className="bg-white border border-slate-200 rounded-lg p-6">
              <h2 className="text-sm font-semibold text-slate-900 mb-2">파일</h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                조회 권한입니다. 업로드는 비활성화되어 있고, 아래 파일 목록의
                「미리보기」 버튼으로 PDF 내용을 확인할 수 있습니다.
                <br />
                개별 다운로드는 Master/Accounting 권한에서만 가능합니다.
              </p>
            </aside>
          )}

          {isMain && supplementInfos.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-900">
                  부속 계약 PDF ({supplementInfos.length})
                </h2>
                <p className="text-[11px] text-slate-500 mt-1">
                  각 부속의 PDF를 직접 업로드하세요. 일자는 메인 상속.
                </p>
              </div>
              <div className="p-3 space-y-3">
                {supplementInfos.map((s) => (
                  <SupplementCard
                    key={s.id}
                    supplement={s}
                    canUpload={writer}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">
            업로드된 파일 ({files?.length ?? 0})
          </h2>
        </div>
        {!hasFiles ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            업로드된 파일이 없습니다.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 bg-slate-50">
                <th className="text-left px-5 py-2 font-medium">버전</th>
                <th className="text-left px-5 py-2 font-medium">파일명</th>
                <th className="text-right px-5 py-2 font-medium">크기</th>
                <th className="text-left px-5 py-2 font-medium">업로드일시</th>
                <th className="text-left px-5 py-2 font-medium">최신</th>
                <th className="text-right px-5 py-2 font-medium">동작</th>
              </tr>
            </thead>
            <tbody>
              {files!.map((f) => (
                <tr key={f.id} className="border-t border-slate-100">
                  <td className="px-5 py-2 tabular-nums">v{f.version_no}</td>
                  <td className="px-5 py-2">{f.original_filename}</td>
                  <td className="px-5 py-2 text-right tabular-nums">
                    {(f.file_size_bytes / 1024 / 1024).toFixed(2)} MB
                  </td>
                  <td className="px-5 py-2 text-slate-600 text-xs">
                    {fmtDateTime(f.uploaded_at)}
                  </td>
                  <td className="px-5 py-2">
                    {f.is_latest && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                        LATEST
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      <FilePreviewButton
                        fileId={f.id}
                        filename={f.original_filename}
                        canDownload={writer}
                      />
                      {writer && (
                        <FileDeleteButton
                          fileId={f.id}
                          contractId={contract.id}
                          filename={f.original_filename}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">상태 이력</h2>
          </div>
          {(history?.length ?? 0) === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">
              이력이 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {history!.map((h) => (
                <li key={h.id} className="px-5 py-3 text-sm">
                  <p className="text-slate-900">
                    {h.from_status
                      ? `${STATUS_LABEL[h.from_status]} → `
                      : ''}
                    <b>{STATUS_LABEL[h.to_status]}</b>
                    <span className="ml-2 text-xs text-slate-500">
                      ({TRANSITION_LABEL[h.transition_type] ?? h.transition_type})
                    </span>
                    {h.is_correction && (
                      <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                        보정
                      </span>
                    )}
                  </p>
                  {h.reason && (
                    <p className="text-xs text-slate-500 mt-1">{h.reason}</p>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1">
                    {fmtDateTime(h.changed_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">연장 이력</h2>
          </div>
          {autoRows.length > 0 && (
            <p className="px-5 py-2 text-xs text-orange-800 bg-orange-50 border-b border-orange-100">
              🔄 자동연장 {autoRows.length}회 경과 · 다음 갱신{' '}
              <b className="tabular-nums">
                {fmtDate(effectiveExpiry(contract))}
              </b>
            </p>
          )}
          {extensionRows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">
              연장 이력이 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {extensionRows.map((e) => (
                <li
                  key={e.kind === 'manual' ? e.id : `auto-${e.previousExpiry}`}
                  className={`px-5 py-3 text-sm ${
                    e.kind === 'auto' ? 'bg-orange-50/60' : ''
                  }`}
                >
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded ${
                      e.kind === 'auto'
                        ? 'bg-orange-100 text-orange-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {e.kind === 'auto' ? '🔄 자동연장(계산)' : '✏️ 수동 연장'}
                  </span>
                  <p className="text-slate-900 tabular-nums mt-1.5">
                    {fmtDate(e.previousExpiry)} → <b>{fmtDate(e.newExpiry)}</b>
                  </p>
                  {e.kind === 'auto' ? (
                    <p className="text-xs text-slate-500 mt-1">
                      자동연장 조건
                      {formatAutoRenewalPeriod(
                        contract.auto_renewal_period_months,
                      ) &&
                        ` (${formatAutoRenewalPeriod(
                          contract.auto_renewal_period_months,
                        )} 주기)`}
                    </p>
                  ) : (
                    <>
                      {e.reason && (
                        <p className="text-xs text-slate-500 mt-1">
                          {e.reason}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-400 mt-1">
                        {fmtDateTime(e.at)}
                      </p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900 mt-0.5 tabular-nums">{children}</dd>
    </div>
  );
}
