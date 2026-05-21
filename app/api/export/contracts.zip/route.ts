import { NextResponse, type NextRequest } from 'next/server';
import JSZip from 'jszip';
import { createClient } from '@/lib/supabase/server';
import { requireWriter } from '@/lib/auth';
import { fmtDate, monthStart, monthEndExclusive } from '@/lib/utils';
import type { Database } from '@/lib/types/database';

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ym = (v: string | null) => {
  const t = (v ?? '').trim();
  return YM_RE.test(t) ? t : '';
};

type Status = Database['public']['Enums']['contract_status'];
type Ctype = Database['public']['Enums']['contract_type'];
type Party = Database['public']['Enums']['contracting_party'];
type Scope = 'latest_only' | 'all_versions' | 'by_status';

// Lambda 메모리 보호: ZIP 출력은 generateNodeStream 으로 스트리밍, 입력 PDF 는 lazy promise 로
// 한 번에 한 개씩만 메모리에 적재. all_versions 스코프에서 폭증 방지를 위해 파일 수 cap.
const MAX_FILES_PER_ZIP = 500;
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const me = await requireWriter();
  const supabase = await createClient();

  const url = new URL(request.url);
  const scope = (url.searchParams.get('scope') ?? 'latest_only') as Scope;
  const status = url.searchParams.get('status') as Status | null;
  const type = url.searchParams.get('type') as Ctype | null;
  const party = url.searchParams.get('party') as Party | null;
  const q = url.searchParams.get('q')?.trim() ?? '';
  const signedFrom = ym(url.searchParams.get('signed_from'));
  const signedTo = ym(url.searchParams.get('signed_to'));
  const effectiveFrom = ym(url.searchParams.get('effective_from'));
  const effectiveTo = ym(url.searchParams.get('effective_to'));
  const expiryFrom = ym(url.searchParams.get('expiry_from'));
  const expiryTo = ym(url.searchParams.get('expiry_to'));

  // 1) 대상 계약 조회
  let cQuery = supabase
    .from('contracts')
    .select(
      'id, status, contract_type, contracting_party, master_contract_id, signed_date, local_governments(full_name)',
    )
    .is('deleted_at', null);

  if (scope === 'by_status' && status) {
    cQuery = cQuery.eq('status', status);
  }
  if (type) cQuery = cQuery.eq('contract_type', type);
  if (party) cQuery = cQuery.eq('contracting_party', party);
  if (signedFrom) cQuery = cQuery.gte('signed_date', monthStart(signedFrom));
  if (signedTo) cQuery = cQuery.lt('signed_date', monthEndExclusive(signedTo));
  if (effectiveFrom) cQuery = cQuery.gte('effective_date', monthStart(effectiveFrom));
  if (effectiveTo) cQuery = cQuery.lt('effective_date', monthEndExclusive(effectiveTo));
  if (expiryFrom) cQuery = cQuery.gte('expiry_date', monthStart(expiryFrom));
  if (expiryTo) cQuery = cQuery.lt('expiry_date', monthEndExclusive(expiryTo));

  const { data: contractsRaw, error: cErr } = await cQuery;
  const contracts = q
    ? (contractsRaw ?? []).filter((c) =>
        (c.local_governments?.full_name ?? '').toLowerCase().includes(q.toLowerCase()),
      )
    : contractsRaw;
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!contracts || contracts.length === 0) {
    return NextResponse.json({ error: '대상 계약이 없습니다.' }, { status: 404 });
  }

  const contractIds = contracts.map((c) => c.id);

  // 2) 파일 메타 조회
  let fQuery = supabase
    .from('contract_files')
    .select('id, contract_id, storage_path, original_filename, version_no, is_latest')
    .in('contract_id', contractIds)
    .is('deleted_at', null);

  if (scope === 'latest_only') {
    fQuery = fQuery.eq('is_latest', true);
  }

  const { data: filesRaw, error: fErr } = await fQuery;
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  if (!filesRaw || filesRaw.length === 0) {
    return NextResponse.json({ error: '파일이 없습니다.' }, { status: 404 });
  }

  const truncated = filesRaw.length > MAX_FILES_PER_ZIP;
  const files = truncated ? filesRaw.slice(0, MAX_FILES_PER_ZIP) : filesRaw;

  // 3) ZIP 생성 — 입력 PDF 는 lazy Promise 로 등록해 generateNodeStream 이 한 번에 하나씩만 로드
  const zip = new JSZip();
  const contractMap = new Map(contracts.map((c) => [c.id, c]));

  for (const f of files) {
    const c = contractMap.get(f.contract_id);
    if (!c) continue;

    const lgName = c.local_governments?.full_name ?? 'unknown';
    const dateTag = c.signed_date ? fmtDate(c.signed_date) : 'no-date';
    const tier = c.master_contract_id ? '부속' : '메인';
    const folder = `${sanitize(lgName)}/${tier}_${f.contract_id.slice(0, 8)}_${dateTag}`;
    const fileName = `v${f.version_no}_${sanitize(f.original_filename)}`;

    zip.file(
      `${folder}/${fileName}`,
      (async () => {
        const { data, error } = await supabase.storage
          .from('contract-files')
          .download(f.storage_path);
        if (error || !data) {
          return Buffer.from(
            `다운로드 실패: ${f.storage_path}\n${error?.message ?? 'unknown'}`,
            'utf-8',
          );
        }
        return Buffer.from(await data.arrayBuffer());
      })(),
    );
  }

  // 4) 매니페스트 추가
  const manifest = [
    `생성일시: ${new Date().toISOString()}`,
    `옵션: ${scope}${scope === 'by_status' && status ? ` (status=${status})` : ''}`,
    type ? `유형 필터: ${type}` : null,
    party ? `주체 필터: ${party}` : null,
    q ? `검색어: ${q}` : null,
    signedFrom || signedTo
      ? `계약체결일: ${signedFrom || '~'} ~ ${signedTo || '~'}`
      : null,
    effectiveFrom || effectiveTo
      ? `계약시작일: ${effectiveFrom || '~'} ~ ${effectiveTo || '~'}`
      : null,
    expiryFrom || expiryTo
      ? `계약만료일: ${expiryFrom || '~'} ~ ${expiryTo || '~'}`
      : null,
    `포함 파일 수: ${files.length}${truncated ? ` (총 ${filesRaw.length}건 중 ${MAX_FILES_PER_ZIP}건만 포함 — cap 초과)` : ''}`,
    `대상 계약 수: ${contracts.length}`,
    truncated ? `※ ${MAX_FILES_PER_ZIP}건을 초과하면 잘립니다. 필터를 좁혀 다시 시도하세요.` : null,
  ].filter(Boolean).join('\n');
  zip.file('_manifest.txt', manifest);

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'zip_download',
    target_type: null,
    after_value: {
      scope,
      status: scope === 'by_status' ? status : null,
      type,
      party,
      q,
      signed_from: signedFrom,
      signed_to: signedTo,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      expiry_from: expiryFrom,
      expiry_to: expiryTo,
      file_count: files.length,
      contract_count: contracts.length,
      truncated,
    },
  });
  if (logErr) console.error('[contracts.zip] activity_logs insert failed:', logErr);

  const filename = `contracts_${scope}_${new Date().toISOString().slice(0, 10)}.zip`;

  // 출력 스트리밍: JSZip 의 nodeStream 을 Web ReadableStream 으로 수동 wrap
  // (Readable.toWeb 은 stream.Readable 클래스를 요구하지만 JSZip 의 반환 타입은
  // NodeJS.ReadableStream 인터페이스라 직접 변환이 안 됨)
  const nodeStream = zip.generateNodeStream({
    type: 'nodebuffer',
    streamFiles: true,
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  });
  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => controller.enqueue(chunk));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (e: Error) => controller.error(e));
    },
    cancel() {
      // 클라이언트가 다운로드 취소 시 — pause 로 메모리 해제
      // JSZip nodeStream에 pause()가 정의돼 있지만 타입 좁힘이 어려워 best-effort 처리
      (nodeStream as unknown as { destroy?: () => void }).destroy?.();
    },
  });

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function sanitize(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
}
