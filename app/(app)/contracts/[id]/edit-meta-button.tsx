'use client';

import { useState } from 'react';
import EditMetaModal from './edit-meta-modal';
import type { Database } from '@/lib/types/database';

type Party = Database['public']['Enums']['contracting_party'];
type Ctype = Database['public']['Enums']['contract_type'];

export default function EditMetaButton({
  contract,
  variant = 'full',
}: {
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
  };
  variant?: 'full' | 'icon';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs px-2 py-1 border border-slate-300 hover:bg-slate-50 rounded text-slate-700"
          aria-label="계약 정보 수정"
          title="계약 정보 수정"
        >
          ✏️
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 rounded font-medium"
        >
          ✏️ 정보 수정
        </button>
      )}
      <EditMetaModal open={open} onClose={() => setOpen(false)} contract={contract} />
    </>
  );
}
