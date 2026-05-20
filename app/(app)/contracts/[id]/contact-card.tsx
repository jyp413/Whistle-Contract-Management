'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateContractContact } from './actions';
import Modal from '@/app/components/modal';

type Contact = {
  contact_department: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
};

/**
 * 계약 담당자 카드 — 담당자는 계약(contracts) 단위.
 * 같은 지자체라도 계약별(주차단속/유지보수 등)로 담당 부서·담당자가 다를 수 있음.
 */
export default function ContactCard({
  contractId,
  initial,
  canEdit,
}: {
  contractId: string;
  initial: Contact;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasAny =
    initial.contact_department ||
    initial.contact_name ||
    initial.contact_phone ||
    initial.contact_email;

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-900">계약 담당자</h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs px-2 py-1 border border-slate-300 hover:bg-slate-50 rounded text-slate-700"
          >
            ✏️ 수정
          </button>
        )}
      </div>
      {!hasAny ? (
        <p className="text-xs text-slate-400">등록된 담당자 정보가 없습니다.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label="담당 부서">{initial.contact_department ?? '-'}</Field>
          <Field label="담당자명">{initial.contact_name ?? '-'}</Field>
          <Field label="연락처">{initial.contact_phone ?? '-'}</Field>
          <Field label="이메일">
            {initial.contact_email ? (
              <a href={`mailto:${initial.contact_email}`} className="text-indigo-600 hover:underline break-all">
                {initial.contact_email}
              </a>
            ) : '-'}
          </Field>
        </dl>
      )}
      {open && (
        <EditModal
          contractId={contractId}
          initial={initial}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900 mt-0.5">{children}</dd>
    </div>
  );
}

function EditModal({
  contractId,
  initial,
  onClose,
}: {
  contractId: string;
  initial: Contact;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [dept, setDept] = useState(initial.contact_department ?? '');
  const [name, setName] = useState(initial.contact_name ?? '');
  const [phone, setPhone] = useState(initial.contact_phone ?? '');
  const [email, setEmail] = useState(initial.contact_email ?? '');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (email && !email.includes('@')) {
      setError('이메일 형식이 올바르지 않습니다.');
      return;
    }
    startTransition(async () => {
      const r = await updateContractContact({
        contractId,
        contact_department: dept || null,
        contact_name: name || null,
        contact_phone: phone || null,
        contact_email: email || null,
      });
      if (r.error) {
        setError(r.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal title="계약 담당자 수정" onClose={onClose} maxWidth="lg">
      <form onSubmit={submit} className="space-y-3">
        <Row label="담당 부서">
          <input type="text" value={dept} onChange={(e) => setDept(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
        </Row>
        <Row label="담당자명">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
        </Row>
        <Row label="연락처">
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
        </Row>
        <Row label="이메일">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@example.com" className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
        </Row>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>
        )}

        <p className="text-[11px] text-slate-500">
          ⓘ 담당자는 이 계약 한 건에만 적용됩니다. 같은 지자체라도 계약별로 다를 수 있습니다.
        </p>

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
