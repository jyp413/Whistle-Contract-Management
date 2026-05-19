'use client';

import { useEffect, useState } from 'react';

type Props = {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  required?: boolean;
};

/**
 * 계약금액 입력 — KRW 정수, raw digits state + Intl.NumberFormat 콤마 표시 + "원" suffix.
 * `<input type="number">`는 천 단위 콤마 표시가 안 돼서 type=text + inputMode=numeric 으로 처리.
 * 빈 문자열 → onChange(null). 비숫자 문자 자동 제거.
 */
export default function AmountKrwInput({
  value,
  onChange,
  disabled,
  placeholder = '예: 7,478,000',
  id,
  required,
}: Props) {
  const [raw, setRaw] = useState<string>(value == null ? '' : String(value));

  // 외부 value 변경 동기화 (modal 재오픈 등)
  useEffect(() => {
    setRaw(value == null ? '' : String(value));
  }, [value]);

  const formatted = raw === '' ? '' : new Intl.NumberFormat('ko-KR').format(Number(raw));

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        required={required}
        value={formatted}
        placeholder={placeholder}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^\d]/g, '');
          setRaw(digits);
          onChange(digits === '' ? null : parseInt(digits, 10));
        }}
        className="w-full pr-9 pl-3 py-2 border border-slate-300 rounded text-sm tabular-nums text-right disabled:bg-slate-100 disabled:text-slate-400"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
        원
      </span>
    </div>
  );
}
