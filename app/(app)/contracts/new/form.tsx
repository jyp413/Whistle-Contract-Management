'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createContractAction, listMasterContractsForLG } from './actions';
import SuccessModal from '@/app/components/success-modal';
import LgCombobox, { type LgOption } from '@/app/components/lg-combobox';
import { PARTY_LABEL, TYPE_LABEL, STATUS_LABEL } from '@/lib/utils';
import type { Database } from '@/lib/types/database';

type LG = LgOption;

type Party = Database['public']['Enums']['contracting_party'];
type Ctype = Database['public']['Enums']['contract_type'];

type MasterOption = {
  id: string;
  signed_date: string | null;
  status: string;
  contracting_party: string;
};

const CLASS_LABEL: Record<LG['classification'], string> = {
  si: '시',
  gun: '군',
  gu: '구',
};

export default function NewContractForm({
  localGovernments,
}: {
  localGovernments: LG[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [lgId, setLgId] = useState('');
  const [sido, setSido] = useState('');
  const [contractingParty, setContractingParty] = useState<Party>('monoplatform');
  const [contractType, setContractType] = useState<Ctype>('parking_enforcement');
  const [masterContractId, setMasterContractId] = useState<string>('');
  const [masterOptions, setMasterOptions] = useState<MasterOption[]>([]);
  const [masterLoading, setMasterLoading] = useState(false);
  const [signedDate, setSignedDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [extendedExpiryDate, setExtendedExpiryDate] = useState('');
  const [memo, setMemo] = useState('');
  const [autoRenewal, setAutoRenewal] = useState(false);
  const [autoRenewalMonths, setAutoRenewalMonths] = useState<string>('12');
  const [autoRenewalEndDate, setAutoRenewalEndDate] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const expiryIsPast = !!expiryDate && expiryDate < today;
  const expiryPastBlocking = expiryIsPast && !autoRenewal;
  const isSupplement = contractType !== 'parking_enforcement';
  const [successInfo, setSuccessInfo] = useState<
    | { lgName: string; contractId: string }
    | null
  >(null);

  useEffect(() => {
    if (!lgId || !isSupplement) {
      setMasterOptions([]);
      setMasterContractId('');
      return;
    }
    let cancelled = false;
    setMasterLoading(true);
    listMasterContractsForLG(lgId).then((opts) => {
      if (cancelled) return;
      setMasterOptions(opts);
      setMasterLoading(false);
      if (opts.length === 1) setMasterContractId(opts[0].id);
    });
    return () => {
      cancelled = true;
    };
  }, [lgId, isSupplement]);

  const selectedLg = localGovernments.find((lg) => lg.id === lgId);

  // 광역단체 목록 (sido 고유값, 데이터 출현 순서 유지)
  const sidoList = useMemo(() => {
    const set: string[] = [];
    for (const lg of localGovernments) {
      if (!set.includes(lg.sido)) set.push(lg.sido);
    }
    return set;
  }, [localGovernments]);

  // 선택된 sido 내 시/군/구 목록
  const sigunguList = useMemo(() => {
    if (!sido) return [];
    return localGovernments
      .filter((lg) => lg.sido === sido)
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ko'));
  }, [sido, localGovernments]);

  // 검색으로 lgId 변경 시 sido 자동 동기화
  useEffect(() => {
    if (selectedLg && selectedLg.sido !== sido) {
      setSido(selectedLg.sido);
    }
  }, [selectedLg, sido]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!lgId) {
      setError('지자체를 선택하세요.');
      return;
    }
    if (isSupplement && !masterContractId) {
      setError('부속 계약은 같은 지자체의 메인 계약을 선택해야 합니다.');
      return;
    }
    if (expiryPastBlocking && !extendedExpiryDate) {
      setError('만료일이 이미 지난 계약입니다. 연장 후 만료일을 함께 입력하거나 자동연장을 설정하세요.');
      return;
    }
    if (extendedExpiryDate && expiryDate && extendedExpiryDate <= expiryDate) {
      setError('연장 후 만료일은 기존 만료일 이후여야 합니다.');
      return;
    }
    if (expiryPastBlocking && extendedExpiryDate && extendedExpiryDate < today) {
      setError('연장 후 만료일도 이미 지났습니다. 현재 유효한 만료일을 입력하세요.');
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
      const result = await createContractAction({
        local_government_id: lgId,
        contracting_party: contractingParty,
        contract_type: contractType,
        master_contract_id: isSupplement ? masterContractId : null,
        signed_date: signedDate || null,
        effective_date: effectiveDate || null,
        expiry_date: expiryDate || null,
        extended_expiry_date: extendedExpiryDate || null,
        memo: memo || null,
        auto_renewal: autoRenewal,
        auto_renewal_period_months: periodMonths,
        auto_renewal_end_date: autoRenewal ? (autoRenewalEndDate || null) : null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccessInfo({ lgName: selectedLg?.full_name ?? '', contractId: result.id ?? '' });
    });
  }

  function handleSuccessConfirm() {
    const id = successInfo?.contractId;
    setSuccessInfo(null);
    if (id) router.push(`/contracts/${id}`);
    else router.push('/contracts');
    router.refresh();
  }

  return (
    <>
    <form
      onSubmit={submit}
      className="bg-white border border-slate-200 rounded-lg p-6 space-y-4"
    >
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          지자체 *
        </label>

        <LgCombobox
          options={localGovernments}
          value={lgId}
          onChange={setLgId}
        />
        <p className="mt-1.5 text-[11px] text-slate-500">
          이름으로 검색 — 예: &quot;남양주&quot;, &quot;군위&quot;, &quot;세종&quot;
        </p>

        <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          또는 광역단체로 선택
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select
            value={sido}
            onChange={(e) => {
              setSido(e.target.value);
              setLgId('');
            }}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
          >
            <option value="">광역단체 선택</option>
            {sidoList.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={lgId}
            onChange={(e) => setLgId(e.target.value)}
            disabled={!sido}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">
              {sido ? '시/군/구 선택' : '먼저 광역단체를 선택하세요'}
            </option>
            {sigunguList.map((lg) => (
              <option key={lg.id} value={lg.id}>
                {labelFor(lg)}
              </option>
            ))}
          </select>
        </div>

        {selectedLg && (
          <p className="mt-2 text-xs text-slate-600">
            선택됨:{' '}
            <span className="font-medium text-slate-900">
              {selectedLg.full_name}
            </span>{' '}
            <span className="text-slate-400">
              ({CLASS_LABEL[selectedLg.classification]})
            </span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            계약 주체 *
          </label>
          <select
            value={contractingParty}
            onChange={(e) => setContractingParty(e.target.value as Party)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
          >
            {(Object.keys(PARTY_LABEL) as Party[]).map((p) => (
              <option key={p} value={p}>
                {PARTY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            계약 유형 *
          </label>
          <select
            value={contractType}
            onChange={(e) => {
              const next = e.target.value as Ctype;
              setContractType(next);
              if (next === 'parking_enforcement') setMasterContractId('');
            }}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
          >
            {(Object.keys(TYPE_LABEL) as Ctype[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
                {t === 'parking_enforcement' ? ' (메인)' : ' (부속)'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isSupplement && (
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            메인 계약 * <span className="text-slate-400 font-normal">(같은 지자체의 주차단속 위수탁 계약)</span>
          </label>
          <select
            value={masterContractId}
            onChange={(e) => setMasterContractId(e.target.value)}
            disabled={!lgId || masterLoading}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">
              {!lgId
                ? '먼저 지자체를 선택하세요'
                : masterLoading
                ? '로딩 중…'
                : masterOptions.length === 0
                ? '활성 메인 계약 없음 — 메인 계약을 먼저 등록하세요'
                : '메인 계약 선택'}
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
        <FormDate
          label="계약체결일"
          value={signedDate}
          onChange={setSignedDate}
        />
        <FormDate
          label="계약시작일"
          value={effectiveDate}
          onChange={setEffectiveDate}
        />
        <FormDate
          label="계약만료일"
          value={expiryDate}
          onChange={setExpiryDate}
        />
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
              <p className="text-[11px] text-slate-500 mt-1">
                12 = 1년, 24 = 2년 (만료일이 매 주기마다 자동으로 미래로 갱신됨)
              </p>
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
              <p className="text-[11px] text-slate-500 mt-1">
                비우면 무기한 자동연장. 입력 시 그 날짜를 넘기지 않음.
              </p>
            </div>
          </div>
        )}
      </div>

      {expiryPastBlocking && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 space-y-3">
          <p className="text-xs text-amber-800">
            ⚠️ 입력하신 계약만료일이 이미 지났습니다. 이 계약이 연장되어 현재도 유효하다면, <strong>연장 후 만료일</strong>을 함께 입력하세요.
          </p>
          <div>
            <label className="block text-xs font-medium text-amber-900 mb-1">
              연장 후 만료일 *
            </label>
            <input
              type="date"
              value={extendedExpiryDate}
              onChange={(e) => setExtendedExpiryDate(e.target.value)}
              min={today}
              required
              className="w-full sm:w-1/3 px-3 py-2 border border-amber-300 rounded text-sm tabular-nums bg-white"
            />
          </div>
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

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/contracts')}
          className="text-sm px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 rounded"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={pending}
          className="text-sm px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded font-medium"
        >
          {pending ? '저장 중…' : '등록 (체결중 진입)'}
        </button>
      </div>
    </form>

    {successInfo && (
      <SuccessModal
        message={`"${successInfo.lgName}" 계약이 등록되었습니다.\n상태: 체결중`}
        onClose={handleSuccessConfirm}
        confirmLabel="확인 — 계약 목록으로"
      />
    )}
    </>
  );
}

function labelFor(lg: LG): string {
  // full_name 에서 sido 부분을 떼고 표시 — 드롭다운 안에서는 시/군/구만 보여 깔끔
  const trimmed = lg.full_name.startsWith(lg.sido + ' ')
    ? lg.full_name.slice(lg.sido.length + 1)
    : lg.full_name;
  return trimmed;
}

function FormDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label}
      </label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-slate-300 rounded text-sm tabular-nums"
      />
    </div>
  );
}
