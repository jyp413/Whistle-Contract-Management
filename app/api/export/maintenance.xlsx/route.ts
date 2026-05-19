import { NextResponse, type NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/lib/supabase/server';
import { requireWriter } from '@/lib/auth';
import {
  STATUS_LABEL,
  PARTY_LABEL,
  fmtDate,
  fmtDateTime,
  effectiveExpiry,
  formatAutoRenewalPeriod,
} from '@/lib/utils';
import type { Database } from '@/lib/types/database';

type Status = Database['public']['Enums']['contract_status'];
type Party = Database['public']['Enums']['contracting_party'];

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const me = await requireWriter();
  const supabase = await createClient();

  const url = new URL(request.url);
  const status = url.searchParams.get('status') as Status | 'all' | null;
  const party = url.searchParams.get('party') as Party | 'all' | null;
  const q = url.searchParams.get('q')?.trim() ?? '';

  let query = supabase
    .from('contracts')
    .select(
      'id, status, contract_type, contracting_party, signed_date, effective_date, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date, amount_krw, termination_reason, memo, updated_at, local_governments(full_name, sigungu, sido, contact_department, contact_name, contact_phone, contact_email)',
    )
    .eq('contract_type', 'mou')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (status && status !== 'all') {
    query = query.eq('status', status);
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
    rows = rows.filter((c) => {
      const lg = c.local_governments;
      return (
        (lg?.full_name ?? '').toLowerCase().includes(needle) ||
        (lg?.contact_department ?? '').toLowerCase().includes(needle) ||
        (lg?.contact_name ?? '').toLowerCase().includes(needle) ||
        (lg?.contact_phone ?? '').toLowerCase().includes(needle) ||
        (lg?.contact_email ?? '').toLowerCase().includes(needle) ||
        (c.memo ?? '').toLowerCase().includes(needle)
      );
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = '주차단속 계약관리 시스템';
  wb.created = new Date();

  const ws = wb.addWorksheet('유지보수 계약');
  ws.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: '지자체', key: 'lg', width: 26 },
    { header: '담당부서', key: 'dept', width: 18 },
    { header: '담당자', key: 'contact', width: 12 },
    { header: '전화', key: 'phone', width: 16 },
    { header: '이메일', key: 'email', width: 26 },
    { header: '주체', key: 'party', width: 14 },
    { header: '상태', key: 'status', width: 10 },
    { header: '계약체결일', key: 'signed', width: 12 },
    { header: '계약시작일', key: 'effective', width: 12 },
    { header: '계약만료일', key: 'expiry', width: 12 },
    { header: '연장 후 만료일', key: 'extended', width: 14 },
    { header: '자동연장', key: 'autoRenewal', width: 14 },
    { header: '실효 만료일', key: 'effExpiry', width: 12 },
    { header: '계약금액(KRW)', key: 'amount', width: 18 },
    { header: '비고', key: 'memo', width: 40 },
    { header: '종료 사유', key: 'termReason', width: 30 },
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

  rows.forEach((c, idx) => {
    const lg = c.local_governments;
    ws.addRow({
      no: idx + 1,
      lg: lg?.full_name ?? '-',
      dept: lg?.contact_department ?? '',
      contact: lg?.contact_name ?? '',
      phone: lg?.contact_phone ?? '',
      email: lg?.contact_email ?? '',
      party: PARTY_LABEL[c.contracting_party],
      status: STATUS_LABEL[c.status],
      signed: fmtDate(c.signed_date),
      effective: fmtDate(c.effective_date),
      expiry: fmtDate(c.expiry_date),
      extended: fmtDate(c.extended_expiry_date),
      autoRenewal: c.auto_renewal
        ? `${formatAutoRenewalPeriod(c.auto_renewal_period_months)}${c.auto_renewal_end_date ? ` (~${c.auto_renewal_end_date})` : ''}`
        : '',
      effExpiry: fmtDate(effectiveExpiry(c)),
      amount: c.amount_krw != null ? c.amount_krw : '',
      memo: c.memo ?? '',
      termReason: c.termination_reason ?? '',
      updated: fmtDateTime(c.updated_at),
      id: c.id,
    });
  });

  // 계약금액 컬럼 — 천 단위 콤마 표시
  ws.getColumn('amount').numFmt = '#,##0';

  ws.eachRow({ includeEmpty: false }, (row) => {
    row.alignment = { vertical: 'middle' };
  });

  await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'zip_download',
    target_type: null,
    after_value: {
      type: 'excel_export_maintenance',
      filter: { status, party, q },
      count: rows.length,
    },
  });

  const buffer = await wb.xlsx.writeBuffer();
  const arrayBuffer = buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer).buffer;
  const filename = `maintenance_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(arrayBuffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
