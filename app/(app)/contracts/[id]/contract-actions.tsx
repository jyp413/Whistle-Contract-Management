'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  applyCorrection,
  extendContract,
  startRenewal,
  terminateContract,
} from './actions';
import type { Database } from '@/lib/types/database';
import { STATUS_LABEL, fmtDate, fmtDateTime } from '@/lib/utils';

type Status = Database['public']['Enums']['contract_status'];

type HistoryItem = {
  id: string;
  from_status: Status | null;
  to_status: Status;
  transition_type: Database['public']['Enums']['transition_type'];
  is_correction: boolean;
  changed_at: string;
};

export default function ContractActions({
  contractId,
  status,
  version,
  effectiveExpiry,
  history,
  userRole,
  parentContractId,
}: {
  contractId: string;
  status: Status;
  version: number;
  effectiveExpiry: string | null;
  history: HistoryItem[];
  userRole: 'master' | 'accounting' | 'viewer';
  parentContractId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<
    null | 'extend' | 'terminate' | 'renew' | 'correct'
  >(null);

  if (userRole === 'viewer') return null;

  return (
    <div className="flex flex-wrap gap-2">
      {status === 'completed' && (
        <ActionBtn label="기간 연장" tone="indigo" onClick={() => setOpen('extend')} />
      )}
      {status === 'completed' && (
        <ActionBtn label="갱신 착수" tone="blue" onClick={() => setOpen('renew')} />
      )}
      {status !== 'terminated' && (
        <ActionBtn
          label="종료"
          tone="slate"
          onClick={() => setOpen('terminate')}
        />
      )}
      <ActionBtn
        label="상태 보정"
        tone="amber"
        onClick={() => setOpen('correct')}
      />

      {open === 'extend' && (
        <ExtendModal
          contractId={contractId}
          version={version}
          currentExpiry={effectiveExpiry}
          onClose={() => setOpen(null)}
          onSuccess={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      )}
      {open === 'terminate' && (
        <TerminateModal
          contractId={contractId}
          version={version}
          status={status}
          onClose={() => setOpen(null)}
          onSuccess={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      )}
      {open === 'renew' && (
        <RenewModal
          contractId={contractId}
          version={version}
          onClose={() => setOpen(null)}
          onSuccess={(newId) => {
            setOpen(null);
            router.push(`/contracts/${newId}`);
            router.refresh();
          }}
        />
      )}
      {open === 'correct' && (
        <CorrectModal
          contractId={contractId}
          version={version}
          history={history}
          userRole={userRole}
          parentContractId={parentContractId}
          onClose={() => setOpen(null)}
          onSuccess={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ActionBtn({
  label,
  onClick,
  tone,
}: {
  label: string;
  onClick: () => void;
  tone: 'indigo' | 'blue' | 'slate' | 'amber';
}) {
  const cls = {
    indigo: 'bg-indigo-600 hover:bg-indigo-700 text-white',
    blue: 'bg-blue-600 hover:bg-blue-700 text-white',
    slate: 'bg-slate-700 hover:bg-slate-800 text-white',
    amber: 'border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded ${cls}`}
    >
      {label}
    </button>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-slate-900 mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ExtendModal({
  contractId,
  version,
  currentExpiry,
  onClose,
  onSuccess,
}: {
  contractId: string;
  version: number;
  currentExpiry: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState('');

  function submit() {
    setError(null);
    if (!newDate) {
      setError('새 만료일을 선택하세요.');
      return;
    }
    start(async () => {
      const r = await extendContract({
        contractId,
        expectedVersion: version,
        newExpiryDate: newDate,
        reason: reason || null,
      });
      if (r.error) setError(r.error);
      else onSuccess();
    });
  }

  return (
    <Modal title="계약기간 연장" onClose={onClose}>
      <p className="text-xs text-slate-600 mb-3">
        현재 실효 만료일:{' '}
        <b className="tabular-nums">{currentExpiry ? fmtDate(currentExpiry) : '-'}</b>
      </p>
      <div className="space-y-3">
        <Field label="새 만료일 *">
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            min={currentExpiry ?? undefined}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm tabular-nums"
          />
        </Field>
        <Field label="연장 사유 (권장)">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
          />
        </Field>
      </div>
      {error && <Err msg={error} />}
      <Footer onClose={onClose} pending={pending} onSubmit={submit} label="연장 적용" />
    </Modal>
  );
}

function TerminateModal({
  contractId,
  version,
  status,
  onClose,
  onSuccess,
}: {
  contractId: string;
  version: number;
  status: Status;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  function submit() {
    setError(null);
    if (!reason.trim()) {
      setError('종료 사유는 필수입니다.');
      return;
    }
    start(async () => {
      const r = await terminateContract({
        contractId,
        expectedVersion: version,
        reason,
      });
      if (r.error) setError(r.error);
      else onSuccess();
    });
  }

  return (
    <Modal title="계약 종료 처리" onClose={onClose}>
      <p className="text-xs text-slate-600 mb-3">
        현재 상태 <b>{STATUS_LABEL[status]}</b> → <b>종료</b>로 변경합니다.
      </p>
      <Field label="종료 사유 *">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
        />
      </Field>
      {error && <Err msg={error} />}
      <Footer
        onClose={onClose}
        pending={pending}
        onSubmit={submit}
        label="종료 처리"
        tone="danger"
      />
    </Modal>
  );
}

function RenewModal({
  contractId,
  version,
  onClose,
  onSuccess,
}: {
  contractId: string;
  version: number;
  onClose: () => void;
  onSuccess: (newId: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    start(async () => {
      const r = await startRenewal({
        parentContractId: contractId,
        expectedVersion: version,
      });
      if (r.error) setError(r.error);
      else if (r.newId) onSuccess(r.newId);
    });
  }

  return (
    <Modal title="갱신 착수" onClose={onClose}>
      <p className="text-sm text-slate-700 mb-3">
        신규 계약 건이 <b>「갱신중」</b> 상태로 별도 생성됩니다. 기존 계약은 만료일까지
        「계약완료」로 유지됩니다.
      </p>
      <p className="text-xs text-slate-500 mb-3">
        생성 후 신규 계약 상세 화면으로 이동합니다.
      </p>
      {error && <Err msg={error} />}
      <Footer
        onClose={onClose}
        pending={pending}
        onSubmit={submit}
        label="갱신 신규 계약 생성"
      />
    </Modal>
  );
}

function CorrectModal({
  contractId,
  version,
  history,
  userRole,
  parentContractId,
  onClose,
  onSuccess,
}: {
  contractId: string;
  version: number;
  history: HistoryItem[];
  userRole: 'master' | 'accounting' | 'viewer';
  parentContractId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const correctable = history.filter(
    (h) => !h.is_correction && h.from_status !== null,
  );
  const accountingTarget = correctable[0]?.id;
  const [targetId, setTargetId] = useState(accountingTarget ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    if (!targetId) return setError('보정할 이력을 선택하세요.');
    if (!reason.trim()) return setError('보정 사유는 필수입니다.');
    start(async () => {
      const r = await applyCorrection({
        contractId,
        targetHistoryId: targetId,
        expectedVersion: version,
        reason,
      });
      if (r.error) setError(r.error);
      else onSuccess();
    });
  }

  return (
    <Modal title="상태 보정" onClose={onClose}>
      {correctable.length === 0 ? (
        <p className="text-sm text-slate-500">
          보정할 수 있는 상태 변경 이력이 없습니다.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-600 mb-3">
            {userRole === 'accounting'
              ? '직전 상태 변경 1건만 보정할 수 있습니다.'
              : '전체 이력 중 보정할 항목을 선택하세요.'}
            {parentContractId && (
              <span className="block mt-1 text-amber-700">
                ⚠ 본 계약은 갱신으로 생성된 신규 건입니다. 부모 계약의
                「계약완료 → 갱신중」 보정은 부모 계약 상세에서 수행하세요.
              </span>
            )}
          </p>
          <Field label="보정 대상 이력 *">
            {userRole === 'master' ? (
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              >
                {correctable.map((h) => (
                  <option key={h.id} value={h.id}>
                    {fmtDateTime(h.changed_at)} ·{' '}
                    {h.from_status ? STATUS_LABEL[h.from_status] : '신규'} →{' '}
                    {STATUS_LABEL[h.to_status]}
                  </option>
                ))}
              </select>
            ) : (
              correctable[0] && (
                <p className="px-3 py-2 bg-slate-50 border border-slate-200 rounded text-sm">
                  {fmtDateTime(correctable[0].changed_at)} ·{' '}
                  {correctable[0].from_status
                    ? STATUS_LABEL[correctable[0].from_status]
                    : '-'}{' '}
                  → {STATUS_LABEL[correctable[0].to_status]}
                </p>
              )
            )}
          </Field>
          <Field label="보정 사유 *">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </Field>
        </>
      )}
      {error && <Err msg={error} />}
      <Footer
        onClose={onClose}
        pending={pending}
        onSubmit={submit}
        label="보정 적용"
        disabled={correctable.length === 0}
        tone="warn"
      />
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  return (
    <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
      {msg}
    </p>
  );
}

function Footer({
  onClose,
  onSubmit,
  pending,
  label,
  disabled,
  tone = 'primary',
}: {
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
  label: string;
  disabled?: boolean;
  tone?: 'primary' | 'danger' | 'warn';
}) {
  const cls = {
    primary: 'bg-indigo-600 hover:bg-indigo-700',
    danger: 'bg-rose-600 hover:bg-rose-700',
    warn: 'bg-amber-600 hover:bg-amber-700',
  }[tone];
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        disabled={pending}
        className="text-sm px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 rounded"
      >
        취소
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={pending || disabled}
        className={`text-sm px-4 py-2 ${cls} disabled:opacity-50 text-white rounded font-medium`}
      >
        {pending ? '처리 중…' : label}
      </button>
    </div>
  );
}
