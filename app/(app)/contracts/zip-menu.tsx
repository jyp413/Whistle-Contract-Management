'use client';

import { useState } from 'react';
import type { Database } from '@/lib/types/database';

type Status = Database['public']['Enums']['contract_status'] | 'all';

export default function ZipMenu({ status }: { status: Status }) {
  const [open, setOpen] = useState(false);

  const items = [
    {
      label: '최신 버전만 (옵션 A)',
      href: '/api/export/contracts.zip?scope=latest_only',
    },
    {
      label: '모든 버전 (옵션 B)',
      href: '/api/export/contracts.zip?scope=all_versions',
    },
    ...(status !== 'all'
      ? [
          {
            label: `현재 상태(${status})만 (옵션 C)`,
            href: `/api/export/contracts.zip?scope=by_status&status=${status}`,
          },
        ]
      : []),
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-sm font-medium px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 rounded"
      >
        ZIP 다운로드 ▾
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <ul className="absolute right-0 mt-1 z-20 w-64 bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-sm">
            {items.map((it) => (
              <li key={it.href}>
                <a
                  href={it.href}
                  className="block px-3 py-2 hover:bg-slate-50 text-slate-800"
                  onClick={() => setOpen(false)}
                >
                  {it.label}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
