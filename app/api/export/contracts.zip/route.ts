import { NextResponse, type NextRequest } from 'next/server';
import JSZip from 'jszip';
import { createClient } from '@/lib/supabase/server';
import { requireWriter } from '@/lib/auth';
import { fmtDate } from '@/lib/utils';
import type { Database } from '@/lib/types/database';

type Status = Database['public']['Enums']['contract_status'];
type Ctype = Database['public']['Enums']['contract_type'];
type Party = Database['public']['Enums']['contracting_party'];
type Scope = 'latest_only' | 'all_versions' | 'by_status';

export async function GET(request: NextRequest) {
  const me = await requireWriter();
  const supabase = await createClient();

  const url = new URL(request.url);
  const scope = (url.searchParams.get('scope') ?? 'latest_only') as Scope;
  const status = url.searchParams.get('status') as Status | null;
  const type = url.searchParams.get('type') as Ctype | null;
  const party = url.searchParams.get('party') as Party | null;
  const q = url.searchParams.get('q')?.trim() ?? '';

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

  const { data: files, error: fErr } = await fQuery;
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  if (!files || files.length === 0) {
    return NextResponse.json({ error: '파일이 없습니다.' }, { status: 404 });
  }

  // 3) ZIP 생성
  const zip = new JSZip();
  const contractMap = new Map(contracts.map((c) => [c.id, c]));

  let added = 0;
  let failed = 0;

  for (const f of files) {
    const c = contractMap.get(f.contract_id);
    if (!c) continue;

    const lgName = c.local_governments?.full_name ?? 'unknown';
    const dateTag = c.signed_date ? fmtDate(c.signed_date) : 'no-date';
    const folder = `${sanitize(lgName)}/${f.contract_id.slice(0, 8)}_${dateTag}`;
    const fileName = `v${f.version_no}_${sanitize(f.original_filename)}`;

    const { data, error } = await supabase.storage
      .from('contract-files')
      .download(f.storage_path);

    if (error || !data) {
      failed++;
      continue;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    zip.file(`${folder}/${fileName}`, buffer);
    added++;
  }

  if (added === 0) {
    return NextResponse.json(
      { error: `다운로드할 파일이 없습니다. (실패 ${failed})` },
      { status: 404 },
    );
  }

  // 4) 매니페스트 추가
  const manifest = [
    `생성일시: ${new Date().toISOString()}`,
    `옵션: ${scope}${scope === 'by_status' && status ? ` (status=${status})` : ''}`,
    type ? `유형 필터: ${type}` : null,
    party ? `주체 필터: ${party}` : null,
    q ? `검색어: ${q}` : null,
    `포함 파일 수: ${added} (실패 ${failed})`,
    `대상 계약 수: ${contracts.length}`,
  ].filter(Boolean).join('\n');
  zip.file('_manifest.txt', manifest);

  await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'zip_download',
    target_type: null,
    after_value: {
      scope,
      status: scope === 'by_status' ? status : null,
      type,
      party,
      q,
      file_count: added,
      contract_count: contracts.length,
    },
  });

  const blob = await zip.generateAsync({ type: 'arraybuffer' });
  const filename = `contracts_${scope}_${new Date().toISOString().slice(0, 10)}.zip`;

  return new NextResponse(blob, {
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
