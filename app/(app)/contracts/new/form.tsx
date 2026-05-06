'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createContractAction } from './actions';

type LG = { id: string; full_name: string; classification: 'si' | 'gun' | 'gu' };

export default function NewContractForm({
  localGovernments,
}: {
  localGovernments: LG[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lgQuery, setLgQuery] = useState('');
  const [lgId, setLgId] = useState('');
  const [signedDate, setSignedDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [memo, setMemo] = useState('');

  const filteredLgs = useMemo(() => {
    if (!lgQuery) return localGovernments.slice(0, 30);
    const needle = lgQuery.trim().toLowerCase();
    return localGovernments
      .filter((lg) => lg.full_name.toLowerCase().includes(needle))
      .slice(0, 50);
  }, [lgQuery, localGovernments]);

  const selectedLg = localGovernments.find((lg) => lg.id === lgId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!lgId) {
      setError('지자체를 선택하세요.');
      return;
    }
    startTransition(async () => {
      const result = await createContractAction({
        local_government_id: lgId,
        signed_date: signedDate || null,
        effective_date: effectiveDate || null,
        expiry_date: expiryDate || null,
        memo: memo || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/contracts/${result.id}`);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-slate-200 rounded-lg p-6 space-y-4"
    >
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          지자체 *
        </label>
        {selectedLg ? (
          <div className="flex items-center justify-between bg-slate-50 border border-slate-300 rounded px-3 py-2 text-sm">
            <span>{selectedLg.full_name}</span>
            <button
              type="button"
              onClick={() => {
                setLgId('');
                setLgQuery('');
              }}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              변경
            </button>
          </div>
        ) : (
          <div>
            <input
              type="text"
              value={lgQuery}
              onChange={(e) => setLgQuery(e.target.value)}
              placeholder="지자체명을 검색하세요 (예: 분당구)"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
            {lgQuery && (
              <ul className="mt-2 max-h-60 overflow-auto border border-slate-200 rounded bg-white divide-y divide-slate-100">
                {filteredLgs.length === 0 && (
                  <li className="text-xs text-slate-400 px-3 py-2">
                    일치하는 지자체가 없습니다.
                  </li>
                )}
                {filteredLgs.map((lg) => (
                  <li key={lg.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setLgId(lg.id);
                        setLgQuery('');
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50"
                    >
                      {lg.full_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
          onClick={() => router.back()}
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
  );
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
