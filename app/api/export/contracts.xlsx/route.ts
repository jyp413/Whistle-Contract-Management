import { NextResponse, type NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/lib/supabase/server';
import { requireWriter } from '@/lib/auth';
import {
  STATUS_LABEL,
  PARTY_LABEL,
  TYPE_LABEL,
  fmtDate,
  fmtDateTime,
  effectiveExpiry,
} from '@/lib/utils';
import type { Database } from '@/lib/types/database';

type Status = Database['public']['Enums']['contract_status'];
type Ctype = Database['public']['Enums']['contract_type'];
type Party = Database['public']['Enums']['contracting_party'];

export async function GET(request: NextRequest) {
  const me = await requireWriter();
  const supabase = await createClient();

  const url = new URL(request.url);
  const status = url.searchParams.get('status') as Status | 'all' | null;
  const type = url.searchParams.get('type') as Ctype | 'all' | null;
  const party = url.searchParams.get('party') as Party | 'all' | null;
  const q = url.searchParams.get('q')?.trim() ?? '';

  let query = supabase
    .from('contracts')
    .select(
      'id, status, contract_type, contracting_party, master_contract_id, signed_date, effective_date, expiry_date, extended_expiry_date, termination_reason, memo, updated_at, local_governments(full_name, sigungu, sido)',
    )
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  if (type && type !== 'all') {
    query = query.eq('contract_type', type);
  }
  if (party && party !== 'all') {
    query = query.eq('contracting_party', party);
  }

  const { data: contracts, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let rows = contracts ?? [];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((c) =>
      (c.local_governments?.full_name ?? '').toLowerCase().includes(needle),
    );
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = '주차단속 계약관리 시스템';
  wb.created = new Date();

  const ws = wb.addWorksheet('계약 목록');
  ws.columns = [
    { header: '지자체', key: 'lg', width: 26 },
    { header: '유형', key: 'type', width: 16 },
    { header: '주체', key: 'party', width: 14 },
    { header: '계층', key: 'tier', width: 8 },
    { header: '상태', key: 'status', width: 10 },
    { header: '계약체결일', key: 'signed', width: 12 },
    { header: '계약시작일', key: 'effective', width: 12 },
    { header: '계약만료일', key: 'expiry', width: 12 },
    { header: '연장 후 만료일', key: 'extended', width: 14 },
    { header: '실효 만료일', key: 'effExpiry', width: 12 },
    { header: '종료 사유', key: 'termReason', width: 30 },
    { header: '비고', key: 'memo', width: 40 },
    { header: '최종 수정일시', key: 'updated', width: 18 },
    { header: '계약 ID', key: 'id', width: 38 },
  ];

  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F3864' },
  };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const c of rows) {
    ws.addRow({
      lg: c.local_governments?.full_name ?? '-',
      type: TYPE_LABEL[c.contract_type],
      party: PARTY_LABEL[c.contracting_party],
      tier: c.master_contract_id ? '부속' : '메인',
      status: STATUS_LABEL[c.status],
      signed: fmtDate(c.signed_date),
      effective: fmtDate(c.effective_date),
      expiry: fmtDate(c.expiry_date),
      extended: fmtDate(c.extended_expiry_date),
      effExpiry: fmtDate(effectiveExpiry(c)),
      termReason: c.termination_reason ?? '',
      memo: c.memo ?? '',
      updated: fmtDateTime(c.updated_at),
      id: c.id,
    });
  }

  ws.eachRow({ includeEmpty: false }, (row) => {
    row.alignment = { vertical: 'middle' };
  });

  await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'zip_download',
    target_type: null,
    after_value: {
      type: 'excel_export',
      filter: { status, type, party, q },
      count: rows.length,
    },
  });

  const buffer = await wb.xlsx.writeBuffer();
  const arrayBuffer = buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer).buffer;
  const filename = `contracts_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(arrayBuffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
