'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  createContractBatch,
  listMasterContractsForLG,
  type MasterContractSummary,
  type BatchCreatedItem,
} from './actions';
import { registerUploadedFile } from '../[id]/actions';
import SuccessModal from '@/app/components/success-modal';
import LgCombobox, { type LgOption } from '@/app/components/lg-combobox';
import { PARTY_LABEL, TYPE_LABEL, STATUS_LABEL, fmtDate } from '@/lib/utils';
import type { Database } from '@/lib/types/database';

type LG = LgOption;
type Party = Database['public']['Enums']['contracting_party'];
type Ctype = Database['public']['Enums']['contract_type'];
type SupplementType = 'personal_info_outsourcing' | 'mou' | 'other';

const SUPPLEMENT_TYPES: SupplementType[] = [
  'personal_info_outsourcing',
  'mou',
  'other',
];

const CLASS_LABEL: Record<LG['classification'], string> = {
  si: '시',
  gun: '군',
  gu: '구',
};

const MAX_BYTES = 50 * 1024 * 1024;

type FileSlot = {
  file: File | null;
  status: 'idle' | 'uploading' | 'done' | 'error';
  message: string | null;
};

const EMPTY_SLOT: FileSlot = { file: null, status: 'idle', message: null };

export default function NewContractForm({
  localGovernments,
}: {
  localGovernments: LG[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<
    | { lgName: string; created: BatchCreatedItem[]; uploadSummary: string }
    | null
  >(null);

  // 지자체 선택
  const [lgId, setLgId] = useState('');
  const [sido, setSido] = useState('');
  const selectedLg = localGovernments.find((lg) => lg.id === lgId);

  // 주체
  const [contractingParty, setContractingParty] = useState<Party>('monoplatform');

  // 계약 유형 체크박스
  const [includeMain, setIncludeMain] = useState(true);
  const [supChecks, setSupChecks] = useState<Record<SupplementType, boolean>>({
    personal_info_outsourcing: false,
    mou: false,
    other: false,
  });

  // 부속만 등록 시 기존 메인 선택
  const [existingMasterId, setExistingMasterId] = useState('');
  const [masterOptions, setMasterOptions] = useState<MasterContractSummary[]>([]);
  const [masterLoading, setMasterLoading] = useState(false);
  const selectedMaster = masterOptions.find((m) => m.id === existingMasterId);

  // 일자 (메인 직접 입력용)
  const [signedDate, setSignedDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [extendedExpiryDate, setExtendedExpiryDate] = useState('');
  const [autoRenewal, setAutoRenewal] = useState(false);
  const [autoRenewalMonths, setAutoRenewalMonths] = useState('12');
  const [autoRenewalEndDate, setAutoRenewalEndDate] = useState('');
  const [memo, setMemo] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const expiryIsPast = !!expiryDate && expiryDate < today;
  const expiryPastBlocking = expiryIsPast && !autoRenewal;

  const selectedSupplements = SUPPLEMENT_TYPES.filter((t) => supChecks[t]);
  const totalChecked = (includeMain ? 1 : 0) + selectedSupplements.length;
  const supplementOnly = !includeMain && selectedSupplements.length > 0;

  // PDF 파일 슬롯 — 체크된 각 계약에 대응
  const [fileSlots, setFileSlots] = useState<Record<string, FileSlot>>({
    parking_enforcement: { ...EMPTY_SLOT },
    personal_info_outsourcing: { ...EMPTY_SLOT },
    mou: { ...EMPTY_SLOT },
    other: { ...EMPTY_SLOT },
  });

  // 광역단체 목록
  const sidoList = useMemo(() => {
    const set: string[] = [];
    for (const lg of localGovernments) {
      if (!set.includes(lg.sido)) set.push(lg.sido);
    }
    return set;
  }, [localGovernments]);

  const sigunguList = useMemo(() => {
    if (!sido) return [];
    return localGovernments
      .filter((lg) => lg.sido === sido)
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ko'));
  }, [sido, localGovernments]);

  useEffect(() => {
    if (selectedLg && selectedLg.sido !== sido) setSido(selectedLg.sido);
  }, [selectedLg, sido]);

  // 부속만 체크할 때 기존 메인 목록 로드
  useEffect(() => {
    if (!lgId || !supplementOnly) {
      setMasterOptions([]);
      setExistingMasterId('');
      return;
    }
    let cancelled = false;
    setMasterLoading(true);
    listMasterContractsForLG(lgId).then((opts) => {
      if (cancelled) return;
      setMasterOptions(opts);
      setMasterLoading(false);
      if (opts.length === 1) setExistingMasterId(opts[0].id);
    });
    return () => {
      cancelled = true;
    };
  }, [lgId, supplementOnly]);

  function setSlotFile(key: string, file: File | null) {
    setFileSlots((s) => ({
      ...s,
      [key]: { file, status: 'idle', message: null },
    }));
  }

  function validateFile(file: File): string | null {
    if (!file.name.toLowerCase().endsWith('.pdf')) return 'PDF만 업로드 가능합니다.';
    if (file.type && file.type !== 'application/pdf')
      return `PDF 파일만 가능 (현재 MIME: ${file.type})`;
    if (file.size > MAX_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      return `파일 크기 ${mb}MB > 최대 50MB`;
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!lgId) return setError('지자체를 선택하세요.');
    if (totalChecked === 0)
      return setError('등록할 계약을 최소 1개 이상 선택하세요.');
    if (supplementOnly && !existingMasterId)
      return setError('부속만 등록할 때는 기존 메인 계약을 선택해야 합니다.');

    // 메인 직접 등록 시 일자/자동연장 클라이언트 검증
    if (includeMain) {
      if (expiryPastBlocking && !extendedExpiryDate)
        return setError(
          '만료일이 이미 지난 계약입니다. 연장 후 만료일을 입력하거나 자동연장을 설정하세요.',
        );
      if (extendedExpiryDate && expiryDate && extendedExpiryDate <= expiryDate)
        return setError('연장 후 만료일은 기존 만료일 이후여야 합니다.');
      if (
        expiryPastBlocking &&
        extendedExpiryDate &&
        extendedExpiryDate < today
      )
        return setError(
          '연장 후 만료일도 이미 지났습니다. 현재 유효한 만료일을 입력하세요.',
        );
      const periodMonths = autoRenewal ? parseInt(autoRenewalMonths, 10) : null;
      if (autoRenewal && (!periodMonths || periodMonths < 1))
        return setError('자동연장 주기(개월)를 1 이상으로 입력하세요.');
      if (
        autoRenewal &&
        autoRenewalEndDate &&
        expiryDate &&
        autoRenewalEndDate < expiryDate
      )
        return setError('자동연장 종료일은 계약만료일 이후여야 합니다.');
    }

    // 체크된 각 계약의 첨부파일 사전 검증
    const checkedKeys: Ctype[] = [
      ...(includeMain ? (['parking_enforcement'] as Ctype[]) : []),
      ...selectedSupplements,
    ];
    for (const key of checkedKeys) {
      const f = fileSlots[key].file;
      if (f) {
        const err = validateFile(f);
        if (err) return setError(`[${TYPE_LABEL[key]}] ${err}`);
      }
    }

    startTransition(async () => {
      const periodMonths = autoRenewal ? parseInt(autoRenewalMonths, 10) : null;
      const result = await createContractBatch({
        local_government_id: lgId,
        contracting_party: contractingParty,
        include_main: includeMain,
        existing_master_id: supplementOnly ? existingMasterId : null,
        supplements: selectedSupplements,
        signed_date: includeMain ? signedDate || null : null,
        effective_date: includeMain ? effectiveDate || null : null,
        expiry_date: includeMain ? expiryDate || null : null,
        extended_expiry_date: includeMain ? extendedExpiryDate || null : null,
        memo: memo || null,
        auto_renewal: includeMain ? autoRenewal : false,
        auto_renewal_period_months: includeMain ? periodMonths : null,
        auto_renewal_end_date: includeMain
          ? autoRenewal
            ? autoRenewalEndDate || null
            : null
          : null,
      });
      if (result.error || !result.created) {
        setError(result.error ?? '등록 실패');
        return;
      }
      const created = result.created;
      // 파일 업로드 — 각 생성된 계약마다 슬롯의 파일이 있으면 업로드
      const supabase = createClient();
      const uploadResults: string[] = [];
      for (const item of created) {
        const slot = fileSlots[item.contract_type];
        if (!slot.file) continue;
        try {
          const file = slot.file;
          const checksum = await sha256(file);
          const path = `${item.id}/${Date.now()}-${crypto.randomUUID()}.pdf`;
          const up = await supabase.storage
            .from('contract-files')
            .upload(path, file, {
              contentType: 'application/pdf',
              cacheControl: '3600',
              upsert: false,
            });
          if (up.error) throw new Error(up.error.message);
          const reg = await registerUploadedFile({
            contractId: item.id,
            storagePath: path,
            originalFilename: file.name,
            fileSizeBytes: file.size,
            checksumSha256: checksum,
          });
          if (reg.error) throw new Error(reg.error);
          uploadResults.push(`${TYPE_LABEL[item.contract_type]}: 업로드 완료`);
          setFileSlots((s) => ({
            ...s,
            [item.contract_type]: {
              file: null,
              status: 'done',
              message: '업로드 완료',
            },
          }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : '업로드 실패';
          uploadResults.push(
            `${TYPE_LABEL[item.contract_type]}: 업로드 실패 — ${msg} (상세 화면에서 재업로드 가능)`,
          );
          setFileSlots((s) => ({
            ...s,
            [item.contract_type]: {
              file: slot.file,
              status: 'error',
              message: msg,
            },
          }));
        }
      }
      setSuccessInfo({
        lgName: selectedLg?.full_name ?? '',
        created,
        uploadSummary:
          uploadResults.length > 0 ? uploadResults.join('\n') : '첨부 파일 없음',
      });
    });
  }

  function handleSuccessConfirm() {
    const first = successInfo?.created[0];
    setSuccessInfo(null);
    if (first) router.push(`/contracts/${first.id}`);
    else router.push('/contracts');
    router.refresh();
  }

  return (
    <>
      <form
        onSubmit={submit}
        className="bg-white border border-slate-200 rounded-lg p-6 space-y-5"
      >
        {/* 지자체 */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            지자체 *
          </label>
          <LgCombobox
            options={localGovernments}
            value={lgId}
            onChange={setLgId}
          />
          <p className="mt-1.5 text-[11px] text-slate-500">
            이름으로 검색 — 예: &quot;남양주&quot;, &quot;군위&quot;, &quot;세종&quot;
          </p>
          <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            또는 광역단체로 선택
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
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

        {/* 계약 주체 */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            계약 주체 *
          </label>
          <select
            value={contractingParty}
            onChange={(e) => setContractingParty(e.target.value as Party)}
            className="w-full sm:w-1/2 px-3 py-2 border border-slate-300 rounded text-sm bg-white"
          >
            {(Object.keys(PARTY_LABEL) as Party[]).map((p) => (
              <option key={p} value={p}>
                {PARTY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>

        {/* 일자 — 메인 직접 등록 시에만 편집 가능 */}
        {includeMain ? (
          <div className="space-y-4 rounded border border-slate-200 bg-slate-50/60 p-4">
            <p className="text-xs font-medium text-slate-700">
              📅 계약 일자{' '}
              <span className="font-normal text-slate-500">
                (선택한 모든 계약에 동일 적용 — 부속은 메인 일자에 종속)
              </span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormDate label="계약체결일" value={signedDate} onChange={setSignedDate} />
              <FormDate label="계약시작일" value={effectiveDate} onChange={setEffectiveDate} />
              <FormDate label="계약만료일" value={expiryDate} onChange={setExpiryDate} />
            </div>

            <div className="rounded border border-slate-200 bg-white p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRenewal}
                  onChange={(e) => setAutoRenewal(e.target.checked)}
                  className="rounded border-slate-300"
                />
                자동연장 조항이 있는 계약
              </label>
              {autoRenewal && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-6">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      자동연장 주기 (개월) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={autoRenewalMonths}
                      onChange={(e) => setAutoRenewalMonths(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm tabular-nums"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      12 = 1년, 24 = 2년
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      자동연장 종료일{' '}
                      <span className="text-slate-400 font-normal">(선택)</span>
                    </label>
                    <input
                      type="date"
                      value={autoRenewalEndDate}
                      onChange={(e) => setAutoRenewalEndDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm tabular-nums"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">비우면 무기한</p>
                  </div>
                </div>
              )}
            </div>

            {expiryPastBlocking && (
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
          </div>
        ) : (
          supplementOnly && (
            <div className="space-y-3 rounded border border-slate-200 bg-slate-50/60 p-4">
              <p className="text-xs font-medium text-slate-700">
                📅 메인 계약 선택{' '}
                <span className="font-normal text-slate-500">
                  (부속들이 이 메인의 일자를 상속받습니다)
                </span>
              </p>
              <select
                value={existingMasterId}
                onChange={(e) => setExistingMasterId(e.target.value)}
                disabled={!lgId || masterLoading}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white disabled:bg-slate-50"
              >
                <option value="">
                  {!lgId
                    ? '먼저 지자체를 선택하세요'
                    : masterLoading
                      ? '로딩 중…'
                      : masterOptions.length === 0
                        ? '활성 메인 계약 없음 — 메인 계약을 먼저 등록하세요'
                        : '메인 계약 선택'}
                </option>
                {masterOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {(m.signed_date ?? '체결일 미정')} ·{' '}
                    {PARTY_LABEL[m.contracting_party as Party] ?? m.contracting_party} ·{' '}
                    {STATUS_LABEL[m.status as keyof typeof STATUS_LABEL] ?? m.status}
                  </option>
                ))}
              </select>
              {selectedMaster && (
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-700 bg-white border border-slate-200 rounded p-3">
                  <div>
                    <span className="text-slate-400">체결일</span>{' '}
                    {fmtDate(selectedMaster.signed_date)}
                  </div>
                  <div>
                    <span className="text-slate-400">시작일</span>{' '}
                    {fmtDate(selectedMaster.effective_date)}
                  </div>
                  <div>
                    <span className="text-slate-400">만료일</span>{' '}
                    {fmtDate(selectedMaster.expiry_date)}
                  </div>
                  <div>
                    <span className="text-slate-400">자동연장</span>{' '}
                    {selectedMaster.auto_renewal
                      ? `🔄 ${selectedMaster.auto_renewal_period_months}개월`
                      : '없음'}
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {/* 등록할 계약 체크박스 + 파일 슬롯 */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-700">
            📋 등록할 계약 *{' '}
            <span className="font-normal text-slate-500">(최소 1개)</span>
          </p>
          <ContractTypeRow
            checked={includeMain}
            onChange={setIncludeMain}
            label="주차단속 위수탁"
            tag="메인"
            tagClass="bg-indigo-100 text-indigo-700"
            slot={fileSlots.parking_enforcement}
            onFileChange={(f) => setSlotFile('parking_enforcement', f)}
          />
          {SUPPLEMENT_TYPES.map((t) => (
            <ContractTypeRow
              key={t}
              checked={supChecks[t]}
              onChange={(v) => setSupChecks((s) => ({ ...s, [t]: v }))}
              label={TYPE_LABEL[t]}
              tag="부속"
              tagClass="bg-slate-200 text-slate-700"
              slot={fileSlots[t]}
              onFileChange={(f) => setSlotFile(t, f)}
            />
          ))}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            비고
          </label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
          />
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 whitespace-pre-line">
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
            disabled={pending || totalChecked === 0}
            className="text-sm px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded font-medium"
          >
            {pending
              ? '저장 중…'
              : `등록 (${totalChecked}건 · 체결중 진입)`}
          </button>
        </div>
      </form>

      {successInfo && (
        <SuccessModal
          message={`"${successInfo.lgName}"에 ${successInfo.created.length}건 등록되었습니다.\n\n${successInfo.uploadSummary}`}
          onClose={handleSuccessConfirm}
          confirmLabel="확인 — 첫 계약 상세로"
        />
      )}
    </>
  );
}

function ContractTypeRow({
  checked,
  onChange,
  label,
  tag,
  tagClass,
  slot,
  onFileChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  tag: string;
  tagClass: string;
  slot: FileSlot;
  onFileChange: (f: File | null) => void;
}) {
  return (
    <div
      className={`rounded border p-3 ${
        checked ? 'border-orange-300 bg-orange-50/40' : 'border-slate-200 bg-white'
      }`}
    >
      <label className="flex items-center gap-2 text-sm font-medium text-slate-800 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-slate-300"
        />
        {label}
        <span
          className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${tagClass}`}
        >
          {tag}
        </span>
      </label>
      {checked && (
        <div className="mt-2 pl-6">
          <label className="block text-[11px] text-slate-600 mb-1">
            PDF 첨부 <span className="text-slate-400">(선택 — 나중에 상세 화면에서도 업로드 가능)</span>
          </label>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            className="text-xs file:mr-2 file:px-2 file:py-1 file:rounded file:border file:border-slate-300 file:bg-white file:text-slate-700 file:cursor-pointer"
          />
          {slot.file && (
            <p className="text-[11px] text-slate-600 mt-1">
              선택됨: {slot.file.name} ({(slot.file.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
          {slot.status === 'error' && slot.message && (
            <p className="text-[11px] text-red-600 mt-1">
              ✗ {slot.message}
            </p>
          )}
          {slot.status === 'done' && (
            <p className="text-[11px] text-emerald-700 mt-1">✓ 업로드 완료</p>
          )}
        </div>
      )}
    </div>
  );
}

function labelFor(lg: LG): string {
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

async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}
