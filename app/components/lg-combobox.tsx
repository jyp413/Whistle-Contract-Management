'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

export type LgOption = {
  id: string;
  full_name: string;
  sido: string;
  sigungu: string;
  classification: 'si' | 'gun' | 'gu';
};

const CLASS_LABEL: Record<LgOption['classification'], string> = {
  si: '시',
  gun: '군',
  gu: '구',
};

const MAX_VISIBLE = 12;

export default function LgCombobox({
  options,
  value,
  onChange,
  placeholder = '지자체 검색 (예: 남양주, 군위, 세종)',
  disabled = false,
}: {
  options: LgOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value],
  );

  // 선택값 외부 변경 시 검색어 동기화
  useEffect(() => {
    if (selected) setQuery(selected.full_name);
    else setQuery('');
  }, [selected]);

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const filtered = useMemo(() => {
    const q = norm(query);
    const selectedFull = selected?.full_name ?? '';
    if (!q || query === selectedFull) return options.slice(0, MAX_VISIBLE);
    return options
      .filter((o) => norm(o.full_name).includes(q))
      .slice(0, MAX_VISIBLE);
  }, [options, query, selected]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(opt: LgOption) {
    onChange(opt.id);
    setQuery(opt.full_name);
    setOpen(false);
    inputRef.current?.blur();
  }

  function clear() {
    onChange('');
    setQuery('');
    setOpen(true);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[highlight]) pick(filtered[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showClear = !!selected || query.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (selected) onChange('');
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full pl-8 pr-8 py-2 border border-slate-300 rounded text-sm bg-white disabled:bg-slate-50"
        />
        <span
          aria-hidden
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none"
        >
          🔍
        </span>
        {showClear && !disabled && (
          <button
            type="button"
            onClick={clear}
            aria-label="선택 초기화"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-sm leading-none"
          >
            ✕
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-64 overflow-auto bg-white border border-slate-200 rounded shadow-lg text-sm"
        >
          {filtered.map((opt, i) => {
            const isHi = i === highlight;
            const isSel = opt.id === value;
            return (
              <li
                key={opt.id}
                role="option"
                aria-selected={isSel}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(opt);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`px-3 py-2 cursor-pointer flex items-center justify-between ${
                  isHi ? 'bg-orange-50' : ''
                } ${isSel ? 'font-medium text-orange-700' : 'text-slate-800'}`}
              >
                <span>
                  {highlightMatch(opt.full_name, query)}
                  <span className="text-slate-400 text-xs ml-1">
                    ({CLASS_LABEL[opt.classification]})
                  </span>
                </span>
                {isSel && <span className="text-orange-600 text-xs">선택됨</span>}
              </li>
            );
          })}
        </ul>
      )}

      {open && filtered.length === 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded shadow-lg text-sm px-3 py-2 text-slate-500">
          일치하는 지자체가 없습니다.
        </div>
      )}
    </div>
  );
}

function highlightMatch(text: string, q: string) {
  const needle = q.trim();
  if (!needle) return text;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-orange-100 text-orange-900 rounded px-0.5">
        {text.slice(idx, idx + needle.length)}
      </mark>
      {text.slice(idx + needle.length)}
    </>
  );
}
