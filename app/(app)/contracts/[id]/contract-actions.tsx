'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  applyCorrection,
  confirmCompletion,
  deleteContract,
  extendContract,
  startRenewal,
  terminateContract,
} from './actions';
import type { Database } from '@/lib/types/database';
import {
  STATUS_LABEL,
  fmtDate,
  fmtDateTime,
  addMonths,
  formatAutoRenewalPeriod,
} from '@/lib/utils';
import Modal from '@/app/components/modal';
import DateInput from '@/app/components/date-input';

type Status = Database['public']['Enums']['contract_status'];

type HistoryItem = {
  id: string;
  from_status: Status | null;
  to_status: Status;
  transition_type: Database['public']['Enums']['transition_type'];
  is_correction: boolean;
  changed_at: string;
};

type AutoRenewalInfo = {
  periodMonths: number;
  endDate: string | null;
};

export default function ContractActions({
  contractId,
  status,
  contractType,
  version,
  effectiveExpiry,
  autoRenewal,
  renewPrefill,
  history,
  userRole,
  parentContractId,
  supplementCount = 0,
}: {
  contractId: string;
  status: Status;
  contractType: Database['public']['Enums']['contract_type'];
  version: number;
  effectiveExpiry: string | null;
  autoRenewal: AutoRenewalInfo | null;
  /** 갱신 모달에 표시할 전년도 정보 — 사용자가 새 계약 일자·금액을 가늠하기 쉽도록. */
  renewPrefill: {
    signedDate: string | null;
    effectiveDate: string | null;
    expiryDate: string | null;
    amountKrw: number | null;
  };
  history: HistoryItem[];
  userRole: 'master' | 'accounting' | 'viewer';
  parentContractId: string | null;
  /** 메인 계약일 때 살아있는 부속 건수 — terminate cascade 경고용. */
  supplementCount?: number;
}) {
  const isMou = contractType === 'mou';
  const router = useRouter();
  const [open, setOpen] = useState<
    null | 'extend' | 'terminate' | 'renew' | 'correct' | 'delete' | 'complete'
  >(null);
  const [completing, startCompleteTransition] = useTransition();
  const [completeError, setCompleteError] = useState<string | null>(null);
  // 갱신 계약 완료 시 원계약이 만료 전이면 겹침 경고 — 동의 후 force 재호출
  const [overlapWarn, setOverlapWarn] = useState<{ parentExpiry: string } | null>(null);
  const [overlapAck, setOverlapAck] = useState(false);

  if (userRole === 'viewer') return null;

  function closeComplete() {
    setOpen(null);
    setCompleteError(null);
    setOverlapWarn(null);
    setOverlapAck(false);
  }

  function doConfirmCompletion(force = false) {
    setCompleteError(null);
    startCompleteTransition(async () => {
      const r = await confirmCompletion({
        contractId,
        expectedVersion: version,
        force,
      });
      if (r.overlapWarning) {
        setOverlapWarn(r.overlapWarning);
        return;
      }
      if (r.error) {
        setCompleteError(r.error);
        return;
      }
      closeComplete();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {(status === 'in_progress' || status === 'updating') && (
        <ActionBtn
          label="계약 완료로 변경"
          tone="green"
          onClick={() => setOpen('complete')}
        />
      )}
      {status === 'completed' && !isMou && (
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
      {userRole === 'master' && (
        <ActionBtn
          label="삭제"
          tone="danger"
          onClick={() => setOpen('delete')}
        />
      )}

      {open === 'extend' && (
        <ExtendModal
          contractId={contractId}
          version={version}
          currentExpiry={effectiveExpiry}
          autoRenewal={autoRenewal}
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
          supplementCount={supplementCount}
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
          contractType={contractType}
          prefill={renewPrefill}
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
      {open === 'delete' && (
        <DeleteModal
          contractId={contractId}
          version={version}
          onClose={() => setOpen(null)}
          onSuccess={() => {
            setOpen(null);
            router.push('/contracts');
            router.refresh();
          }}
        />
      )}
      {open === 'complete' && (
        <Modal
          title="계약 완료로 변경"
          onClose={() => !completing && closeComplete()}
        >
          <p className="text-sm text-slate-700">
            현재 상태(<b>{STATUS_LABEL[status]}</b>) 에서{' '}
            <b>「계약완료」</b>로 변경합니다.
            <br />
            계속 진행할까요?
          </p>
          {overlapWarn && (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 space-y-2">
              <p className="text-xs text-amber-800 font-medium">
                ⚠ 이 갱신 계약의 원계약이 아직 만료 전입니다 (만료일{' '}
                <b className="tabular-nums">{fmtDate(overlapWarn.parentExpiry)}</b>).
              </p>
              <p className="text-xs text-amber-700 leading-relaxed">
                지금 완료 처리하면 같은 지자체에 <b>「계약완료」 계약 2건이 겹칩니다</b>.
                보통은 원계약 만료(자동 종료) 후에 완료 처리하는 게 KPI·통계가 깔끔합니다.
              </p>
              <label className="flex items-start gap-2 text-xs text-amber-900 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={overlapAck}
                  onChange={(e) => setOverlapAck(e.target.checked)}
                  className="mt-0.5 rounded border-amber-400"
                />
                <span>겹침을 인지했으며 그래도 지금 완료 처리합니다.</span>
              </label>
            </div>
          )}
          {completeError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mt-3">
              {completeError}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeComplete}
              disabled={completing}
              className="text-sm px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 rounded"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => doConfirmCompletion(overlapWarn ? true : false)}
              disabled={completing || (!!overlapWarn && !overlapAck)}
              className="text-sm px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded font-medium"
            >
              {completing
                ? '처리 중…'
                : overlapWarn
                  ? '그래도 계약완료로 변경'
                  : '확인 — 계약완료로 변경'}
            </button>
          </div>
        </Modal>
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
  tone: 'indigo' | 'blue' | 'slate' | 'amber' | 'danger' | 'green';
}) {
  const cls = {
    indigo: 'bg-indigo-600 hover:bg-indigo-700 text-white',
    blue: 'bg-blue-600 hover:bg-blue-700 text-white',
    slate: 'bg-slate-700 hover:bg-slate-800 text-white',
    amber: 'border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white',
    green: 'bg-emerald-600 hover:bg-emerald-700 text-white',
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

function ExtendModal({
  contractId,
  version,
  currentExpiry,
  autoRenewal,
  onClose,
  onSuccess,
}: {
  contractId: string;
  version: number;
  currentExpiry: string | null;
  autoRenewal: AutoRenewalInfo | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState('');

  // 자동연장 1주기 만큼 미리 보기 — 현재 실효 만료일 + period_months.
  // auto_renewal_end_date가 있고 다음 주기가 그것을 넘으면 적용 불가.
  const nextRenewalDate =
    autoRenewal && currentExpiry
      ? addMonths(currentExpiry, autoRenewal.periodMonths)
      : null;
  const exceedsEnd =
    !!(autoRenewal?.endDate && nextRenewalDate && nextRenewalDate > autoRenewal.endDate);

  function applyAutoRenewal() {
    if (!nextRenewalDate || exceedsEnd) return;
    setNewDate(nextRenewalDate);
    if (!reason) setReason('자동연장 기간 적용');
  }

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

      {autoRenewal && nextRenewalDate && (
        <div className="mb-3 rounded border border-orange-200 bg-orange-50 p-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="text-xs text-orange-900 leading-relaxed">
              <p>
                🔄 자동연장 주기:{' '}
                <b>{formatAutoRenewalPeriod(autoRenewal.periodMonths)}</b>
                {autoRenewal.endDate && (
                  <span className="text-slate-600 font-normal">
                    {' '}
                    · 최대 {fmtDate(autoRenewal.endDate)}
                  </span>
                )}
              </p>
              <p className="mt-1">
                다음 주기 만료일 →{' '}
                <b className="tabular-nums">{fmtDate(nextRenewalDate)}</b>
                {exceedsEnd && (
                  <span className="ml-2 text-rose-700">
                    (자동연장 종료일 초과 — 적용 불가)
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={applyAutoRenewal}
              disabled={exceedsEnd}
              className="shrink-0 text-xs font-medium px-3 py-1.5 rounded bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white"
            >
              자동연장 기간 적용
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <Field label="새 만료일 *">
          <DateInput
            value={newDate}
            onChange={setNewDate}
            min={currentExpiry ?? undefined}
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
  supplementCount,
  onClose,
  onSuccess,
}: {
  contractId: string;
  version: number;
  status: Status;
  supplementCount: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [cascadeAck, setCascadeAck] = useState(false);
  const needsCascadeAck = supplementCount > 0;

  function submit() {
    setError(null);
    if (!reason.trim()) {
      setError('종료 사유는 필수입니다.');
      return;
    }
    if (needsCascadeAck && !cascadeAck) {
      setError('부속 계약 자동 종료에 동의해야 진행할 수 있습니다.');
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
      {needsCascadeAck && (
        <div className="mb-3 rounded border border-rose-300 bg-rose-50 p-3 space-y-2">
          <p className="text-xs text-rose-800 font-medium">
            ⚠ 이 메인 계약에는 살아있는 부속 {supplementCount}건이 있습니다.
          </p>
          <p className="text-xs text-rose-700 leading-relaxed">
            메인 종료 시 부속 {supplementCount}건도 <b>「메인 계약 종료에 따른 자동 종료」</b> 사유로
            함께 자동 종료됩니다. 되돌리려면 상태 보정이 필요합니다.
          </p>
          <label className="flex items-start gap-2 text-xs text-rose-900 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={cascadeAck}
              onChange={(e) => setCascadeAck(e.target.checked)}
              className="mt-0.5 rounded border-rose-400"
            />
            <span>위 부속 {supplementCount}건이 함께 자동 종료되는 것을 확인했습니다.</span>
          </label>
        </div>
      )}
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
        disabled={needsCascadeAck && !cascadeAck}
      />
    </Modal>
  );
}

function RenewModal({
  contractId,
  version,
  contractType,
  prefill,
  onClose,
  onSuccess,
}: {
  contractId: string;
  version: number;
  contractType: Database['public']['Enums']['contract_type'];
  prefill: {
    signedDate: string | null;
    effectiveDate: string | null;
    expiryDate: string | null;
    amountKrw: number | null;
  };
  onClose: () => void;
  onSuccess: (newId: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isMou = contractType === 'mou';

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

  const periodLabel = prefill.effectiveDate && prefill.expiryDate
    ? `${fmtDate(prefill.effectiveDate)} ~ ${fmtDate(prefill.expiryDate)}`
    : null;

  return (
    <Modal title={isMou ? '유지보수 갱신 착수' : '갱신 착수'} onClose={onClose}>
      <p className="text-sm text-slate-700 mb-3">
        신규 계약 건이 <b>「갱신중」</b> 상태로 별도 생성됩니다.
        {isMou ? (
          <>
            {' '}유지보수는 매년 재계약이 원칙입니다. 기존 계약은 만료일까지
            「계약완료」로 유지되며, 만료일 다음날 자동으로 종료됩니다.
          </>
        ) : (
          <> 기존 계약은 만료일까지 「계약완료」로 유지됩니다.</>
        )}
      </p>

      <div className="rounded border border-slate-200 bg-slate-50 p-3 mb-3 text-xs">
        <p className="text-slate-500 font-medium mb-1">전년도 계약 정보 (참고용)</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-700">
          <dt className="text-slate-500">체결일</dt>
          <dd className="tabular-nums">{prefill.signedDate ? fmtDate(prefill.signedDate) : '-'}</dd>
          <dt className="text-slate-500">계약기간</dt>
          <dd className="tabular-nums">{periodLabel ?? '-'}</dd>
          {isMou && (
            <>
              <dt className="text-slate-500">계약금액</dt>
              <dd className="tabular-nums font-medium">
                {prefill.amountKrw != null
                  ? new Intl.NumberFormat('ko-KR').format(prefill.amountKrw) + '원'
                  : '-'}
              </dd>
            </>
          )}
        </dl>
        <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
          {isMou
            ? '신규 row의 자동연장·계약금액은 전년도 값으로 prefill 됩니다. 생성 후 상세 화면에서 새 일자·금액을 입력하세요.'
            : '신규 row는 전년도의 자동연장 설정을 그대로 상속받습니다. 생성 후 상세 화면에서 새 일자를 입력하세요.'}
        </p>
      </div>

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

function DeleteModal({
  contractId,
  version,
  onClose,
  onSuccess,
}: {
  contractId: string;
  version: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    start(async () => {
      const r = await deleteContract({
        contractId,
        expectedVersion: version,
      });
      if (r.error) setError(r.error);
      else onSuccess();
    });
  }

  return (
    <Modal title="계약 삭제" onClose={onClose}>
      <p className="text-sm text-slate-700">
        이 계약을 삭제하시겠습니까? 목록·KPI·드릴다운에서{' '}
        <b>즉시 사라집니다</b>.
      </p>
      <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900 leading-relaxed">
        ⚠ DB 이력(상태/연장/활동 로그)은 보존됩니다.
        <br />
        실수로 삭제했다면 관리자가 SQL로 <code>deleted_at = NULL</code> 처리해
        복구할 수 있습니다.
      </div>
      {error && <Err msg={error} />}
      <Footer
        onClose={onClose}
        pending={pending}
        onSubmit={submit}
        label="삭제"
        tone="danger"
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
