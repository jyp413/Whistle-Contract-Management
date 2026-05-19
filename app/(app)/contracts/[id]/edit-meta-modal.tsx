'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateContractMeta } from './actions';
import { listMasterContractsForLG } from '../new/actions';
import { PARTY_LABEL, TYPE_LABEL, STATUS_LABEL } from '@/lib/utils';
import type { Database } from '@/lib/types/database';
import Modal from '@/app/components/modal';

type Party = Database['public']['Enums']['contracting_party'];
type Ctype = Database['public']['Enums']['contract_type'];

type MasterOption = {
  id: string;
  signed_date: string | null;
  status: string;
  contracting_party: string;
};

export default function EditMetaModal({
  open,
  onClose,
  contract,
  supplementCount = 0,
}: {
  open: boolean;
  onClose: () => void;
  contract: {
    id: string;
    version: number;
    local_government_id: string;
    signed_date: string | null;
    effective_date: string | null;
    expiry_date: string | null;
    extended_expiry_date: string | null;
    memo: string | null;
    contract_type: Ctype;
    contracting_party: Party;
    master_contract_id: string | null;
    auto_renewal: boolean;
    auto_renewal_period_months: number | null;
    auto_renewal_end_date: string | null;
  };
  /** 메인 계약일 때 살아있는 부속 건수. 일자 수정 시 stale 경고. */
  supplementCount?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [signedDate, setSignedDate] = useState(contract.signed_date ?? '');
  const [effectiveDate, setEffectiveDate] = useState(contract.effective_date ?? '');
  const [expiryDate, setExpiryDate] = useState(contract.expiry_date ?? '');
  const [extendedExpiry, setExtendedExpiry] = useState(contract.extended_expiry_date ?? '');
  const [memo, setMemo] = useState(contract.memo ?? '');
  const [contractType, setContractType] = useState<Ctype>(contract.contract_type);
  const [party, setParty] = useState<Party>(contract.contracting_party);
  const [masterId, setMasterId] = useState<string>(contract.master_contract_id ?? '');
  const [masterOptions, setMasterOptions] = useState<MasterOption[]>([]);
  const [autoRenewal, setAutoRenewal] = useState(contract.auto_renewal);
  const [autoRenewalMonths, setAutoRenewalMonths] = useState<string>(
    contract.auto_renewal_period_months?.toString() ?? '12',
  );
  const [autoRenewalEndDate, setAutoRenewalEndDate] = useState(
    contract.auto_renewal_end_date ?? '',
  );

  const today = new Date().toISOString().slice(0, 10);
  const isSupplement = contractType !== 'parking_enforcement';
  const expiryIsPast = !!expiryDate && expiryDate < today;
  const expiryPastBlocking = expiryIsPast && !autoRenewal;
  const isMain = !contract.master_contract_id;
  // 메인의 일자/자동연장 필드가 바뀌었는지 — 부속 stale 경고 트리거
  const dateChanged =
    (signedDate || null) !== contract.signed_date ||
    (effectiveDate || null) !== contract.effective_date ||
    (expiryDate || null) !== contract.expiry_date ||
    (extendedExpiry || null) !== contract.extended_expiry_date ||
    autoRenewal !== contract.auto_renewal ||
    (autoRenewal ? parseInt(autoRenewalMonths, 10) || null : null) !==
      contract.auto_renewal_period_months ||
    (autoRenewal ? autoRenewalEndDate || null : null) !==
      contract.auto_renewal_end_date;
  const showStaleSupplementWarning =
    isMain && supplementCount > 0 && dateChanged;

  useEffect(() => {
    if (!open || !isSupplement) {
      setMasterOptions([]);
      return;
    }
    let cancelled = false;
    listMasterContractsForLG(contract.local_government_id).then((opts) => {
      if (cancelled) return;
      // 자기 자신은 제외
      setMasterOptions(opts.filter((o) => o.id !== contract.id));
    });
    return () => {
      cancelled = true;
    };
  }, [open, isSupplement, contract.local_government_id, contract.id]);

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isSupplement && !masterId) {
      setError('부속 계약은 메인 계약을 선택해야 합니다.');
      return;
    }
    if (expiryPastBlocking && !extendedExpiry) {
      setError('만료일이 지났습니다. 연장 후 만료일을 함께 입력하거나 자동연장을 설정하세요.');
      return;
    }
    // 서버 가드와 동일: 연장 후 만료일은 기존 만료일 이후여야 함
    if (extendedExpiry && expiryDate && extendedExpiry <= expiryDate) {
      setError('연장 후 만료일은 기존 만료일 이후여야 합니다.');
      return;
    }
    const periodMonths = autoRenewal ? parseInt(autoRenewalMonths, 10) : null;
    if (autoRenewal && (!periodMonths || periodMonths < 1)) {
      setError('자동연장 주기(개월)를 1 이상으로 입력하세요.');
      return;
    }
    if (autoRenewal && autoRenewalEndDate && expiryDate && autoRenewalEndDate < expiryDate) {
      setError('자동연장 종료일은 계약만료일 이후여야 합니다.');
      return;
    }
    startTransition(async () => {
      const result = await updateContractMeta({
        contractId: contract.id,
        expectedVersion: contract.version,
        signed_date: signedDate || null,
        effective_date: effectiveDate || null,
        expiry_date: expiryDate || null,
        extended_expiry_date: extendedExpiry || null,
        memo: memo || null,
        contract_type: contractType,
        contracting_party: party,
        master_contract_id: isSupplement ? masterId : null,
        auto_renewal: autoRenewal,
        auto_renewal_period_months: periodMonths,
        auto_renewal_end_date: autoRenewal ? (autoRenewalEndDate || null) : null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal title="계약 정보 수정" onClose={onClose} maxWidth="2xl">
      <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">계약 주체 *</label>
              <select value={party} onChange={(e) => setParty(e.target.value as Party)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white">
                {(Object.keys(PARTY_LABEL) as Party[]).map((p) => (
                  <option key={p} value={p}>{PARTY_LABEL[p]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">계약 유형 *</label>
              <select
                value={contractType}
                onChange={(e) => {
                  const next = e.target.value as Ctype;
                  setContractType(next);
                  if (next === 'parking_enforcement') setMasterId('');
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                {(Object.keys(TYPE_LABEL) as Ctype[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}{t === 'parking_enforcement' ? ' (메인)' : ' (부속)'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isSupplement && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">메인 계약 *</label>
              <select value={masterId} onChange={(e) => setMasterId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white">
                <option value="">
                  {masterOptions.length === 0 ? '활성 메인 계약 없음' : '메인 계약 선택'}
                </option>
                {masterOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {(m.signed_date ?? '체결일 미정')} · {PARTY_LABEL[m.contracting_party as Party] ?? m.contracting_party} · {STATUS_LABEL[m.status as keyof typeof STATUS_LABEL] ?? m.status}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <DateField label="계약체결일" value={signedDate} onChange={setSignedDate} />
            <DateField label="계약시작일" value={effectiveDate} onChange={setEffectiveDate} />
            <DateField label="계약만료일" value={expiryDate} onChange={setExpiryDate} />
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRenewal}
                onChange={(e) => setAutoRenewal(e.target.checked)}
                className="rounded border-slate-300"
              />
              자동연장 조항이 있는 계약
            </label>
            {autoRenewal && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-6">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    자동연장 주기 (개월) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={autoRenewalMonths}
                    onChange={(e) => setAutoRenewalMonths(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm tabular-nums"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">12 = 1년, 24 = 2년</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    자동연장 종료일 <span className="text-slate-400 font-normal">(선택)</span>
                  </label>
                  <input
                    type="date"
                    value={autoRenewalEndDate}
                    onChange={(e) => setAutoRenewalEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm tabular-nums"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">비우면 무기한</p>
                </div>
              </div>
            )}
          </div>

          {expiryPastBlocking && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 space-y-2">
              <p className="text-xs text-amber-800">⚠️ 입력한 계약만료일이 이미 지났습니다. 연장 후 만료일을 함께 입력하거나 자동연장을 설정하세요.</p>
              <DateField label="연장 후 만료일 *" value={extendedExpiry} onChange={setExtendedExpiry} min={today} />
            </div>
          )}

          {!expiryPastBlocking && (
            <div>
              <DateField label="연장 후 만료일 (선택)" value={extendedExpiry} onChange={setExtendedExpiry} />
              <p className="text-[11px] text-slate-500 mt-1">
                ⓘ 일반 연장은 상세 화면의 <b>[기간 연장]</b> 버튼을 사용하세요 (연장 이력이 함께 기록됩니다). 이 필드는 잘못 입력된 값을 정정할 때만 사용합니다.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">비고</label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>

          {showStaleSupplementWarning && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              ⚠ 이 메인 계약에는 부속 {supplementCount}건이 있습니다. 일자/자동연장 변경은
              <b>부속에 자동 반영되지 않습니다</b> — 필요 시 각 부속 상세에서 별도로 수정하세요.
            </p>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="text-sm px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 rounded">취소</button>
            <button type="submit" disabled={pending} className="text-sm px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded font-medium">
              {pending ? '저장 중…' : '저장'}
            </button>
          </div>
      </form>
    </Modal>
  );
}

function DateField({ label, value, onChange, min }: { label: string; value: string; onChange: (v: string) => void; min?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        className="w-full px-3 py-2 border border-slate-300 rounded text-sm tabular-nums"
      />
    </div>
  );
}
