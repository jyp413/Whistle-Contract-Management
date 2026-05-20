'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  /** 'YYYY-MM-DD' 형식 또는 빈 문자열 */
  value: string;
  /** 유효한 YYYY-MM-DD 또는 빈 문자열만 전달 (부분 입력 중일 때는 호출 X) */
  onChange: (v: string) => void;
  /** 서버 가드 보완용 — 화면에서 별도 표시는 안 함 */
  min?: string;
  disabled?: boolean;
  id?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
};

/**
 * 날짜 입력 — YYYY-MM-DD.
 * - 숫자 8자리(예: 20260109)를 입력하면 자동으로 YYYY-MM-DD 로 정규화
 * - 'YYYY-MM-DD' 직접 타이핑/붙여넣기도 허용
 * - 빈 값 허용 (onChange('') 로 부모 전달)
 * - 부모 value 가 외부에서 변경되면 raw 동기화. 사용자가 타이핑 중일 때는 raw 유지
 * - native date picker 의도적 미사용 — 키보드 입력 우선
 */
export default function DateInput({
  value,
  onChange,
  disabled,
  id,
  required,
  placeholder = '예: 20260109',
  className,
}: Props) {
  const [raw, setRaw] = useState(value);
  const prevValueRef = useRef(value);

  // 부모 value 가 외부에서 변경된 경우에만 raw 동기화 (사용자 타이핑 보존)
  useEffect(() => {
    if (value !== prevValueRef.current) {
      setRaw(value);
      prevValueRef.current = value;
    }
  }, [value]);

  function normalize(input: string): string {
    const digits = input.replace(/[^\d]/g, '');
    if (digits.length === 8) {
      const y = digits.slice(0, 4);
      const m = digits.slice(4, 6);
      const d = digits.slice(6, 8);
      const mi = parseInt(m, 10);
      const di = parseInt(d, 10);
      // 간단한 유효성 — 월 01-12, 일 01-31
      if (mi >= 1 && mi <= 12 && di >= 1 && di <= 31) {
        return `${y}-${m}-${d}`;
      }
    }
    return input;
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = normalize(e.target.value);
    setRaw(next);
    if (next === '' || /^\d{4}-\d{2}-\d{2}$/.test(next)) {
      onChange(next);
      prevValueRef.current = next;
    }
  }

  function handleBlur() {
    // 잘못된 입력 → 부모 마지막 유효 값으로 복원
    if (raw !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      setRaw(value);
    }
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={placeholder}
      value={raw}
      disabled={disabled}
      required={required}
      onChange={handleChange}
      onBlur={handleBlur}
      className={
        className ??
        'w-full px-3 py-2 border border-slate-300 rounded text-sm tabular-nums disabled:bg-slate-100 disabled:text-slate-400'
      }
    />
  );
}
