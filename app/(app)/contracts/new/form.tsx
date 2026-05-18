'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createContractAction } from './actions';
import SuccessModal from '@/app/components/success-modal';

type LG = {
  id: string;
  full_name: string;
  sido: string;
  sigungu: string;
  classification: 'si' | 'gun' | 'gu';
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

  const [sido, setSido] = useState('');
  const [lgId, setLgId] = useState('');
  const [signedDate, setSignedDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [extendedExpiryDate, setExtendedExpiryDate] = useState('');
  const [memo, setMemo] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const expiryIsPast = !!expiryDate && expiryDate < today;
  const [successInfo, setSuccessInfo] = useState<
    | { lgName: string }
    | null
  >(null);

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

  const selectedLg = localGovernments.find((lg) => lg.id === lgId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!lgId) {
      setError('지자체를 선택하세요.');
      return;
    }
    if (expiryIsPast && !extendedExpiryDate) {
      setError('만료일이 이미 지난 계약입니다. 연장 후 만료일을 함께 입력하세요.');
      return;
    }
    if (extendedExpiryDate && expiryDate && extendedExpiryDate <= expiryDate) {
      setError('연장 후 만료일은 기존 만료일 이후여야 합니다.');
      return;
    }
    if (expiryIsPast && extendedExpiryDate && extendedExpiryDate < today) {
      setError('연장 후 만료일도 이미 지났습니다. 현재 유효한 만료일을 입력하세요.');
      return;
    }
    startTransition(async () => {
      const result = await createContractAction({
        local_government_id: lgId,
        signed_date: signedDate || null,
        effective_date: effectiveDate || null,
        expiry_date: expiryDate || null,
        extended_expiry_date: extendedExpiryDate || null,
        memo: memo || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccessInfo({ lgName: selectedLg?.full_name ?? '' });
    });
  }

  function handleSuccessConfirm() {
    setSuccessInfo(null);
    router.push('/contracts');
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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

      {expiryIsPast && (
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
