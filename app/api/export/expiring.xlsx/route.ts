import { NextResponse, type NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/lib/supabase/server';
import { requireWriter } from '@/lib/auth';
import {
  STATUS_LABEL,
  PARTY_LABEL,
  TYPE_LABEL,
  fmtDate,
  daysUntil,
  effectiveExpiry,
  formatAutoRenewalPeriod,
} from '@/lib/utils';

export const runtime = 'nodejs';

/**
 * 만료 임박 계약 Excel export — /expiring 페이지의 데이터를 그대로 추출.
 * ?window=30|60|90 (default 90).
 */
export async function GET(request: NextRequest) {
  const me = await requireWriter();
  const supabase = await createClient();

  const url = new URL(request.url);
  const winRaw = parseInt(url.searchParams.get('window') ?? '90', 10);
  const validWindow = ([30, 60, 90] as const).includes(winRaw as 30 | 60 | 90)
    ? (winRaw as 30 | 60 | 90)
    : 90;

  const { data: contracts, error } = await supabase
    .from('contracts')
    .select(
      'id, status, contract_type, contracting_party, master_contract_id, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date, local_governments(full_name)',
    )
    .eq('status', 'completed')
    .is('deleted_at', null)
    .order('expiry_date', { ascending: true, nullsFirst: false })
    .limit(1000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enriched = (contracts ?? [])
    .map((c) => {
      const expiry = effectiveExpiry(c);
      const d = daysUntil(expiry);
      return { ...c, expiry, days: d };
    })
    .filter((c) => c.days !== null && c.days >= 0 && c.days <= validWindow)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  const wb = new ExcelJS.Workbook();
  wb.creator = '주차단속 계약관리 시스템';
  wb.created = new Date();

  const ws = wb.addWorksheet(`만료임박 ${validWindow}일`);
  ws.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: '지자체', key: 'lg', width: 26 },
    { header: '유형', key: 'type', width: 18 },
    { header: '계층', key: 'tier', width: 8 },
    { header: '주체', key: 'party', width: 16 },
    { header: '상태', key: 'status', width: 10 },
    { header: '실효 만료일', key: 'expiry', width: 14 },
    { header: 'D-day', key: 'dday', width: 10 },
    { header: '자동연장', key: 'autoRenewal', width: 14 },
    { header: '구분', key: 'risk', width: 12 },
    { header: '계약 ID', key: 'id', width: 38 },
  ];

  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F3864' },
  };

  enriched.forEach((c, idx) => {
    // 자동연장 계약 중 종료일 cap 에 안 걸린 것 = 실제 종료 위험 없음 (다음 주기로 갱신)
    const safeRenewal =
      c.auto_renewal &&
      !(c.auto_renewal_end_date != null && c.expiry === c.auto_renewal_end_date);
    ws.addRow({
      no: idx + 1,
      lg: c.local_governments?.full_name ?? '-',
      type: TYPE_LABEL[c.contract_type],
      tier: c.master_contract_id ? '부속' : '메인',
      party: PARTY_LABEL[c.contracting_party],
      status: STATUS_LABEL[c.status],
      expiry: fmtDate(c.expiry),
      dday: c.days !== null ? `D-${c.days}` : '-',
      autoRenewal: c.auto_renewal
        ? `${formatAutoRenewalPeriod(c.auto_renewal_period_months)}${c.auto_renewal_end_date ? ` (~${c.auto_renewal_end_date})` : ''}`
        : '',
      risk: safeRenewal ? '자동갱신' : '조치 필요',
      id: c.id,
    });
  });

  ws.eachRow({ includeEmpty: false }, (row) => {
    row.alignment = { vertical: 'middle' };
  });

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'zip_download',
    target_type: null,
    after_value: {
      type: 'excel_export_expiring',
      window: validWindow,
      count: enriched.length,
    },
  });
  if (logErr) console.error('[expiring.xlsx] activity_logs insert failed:', logErr);

  const buffer = await wb.xlsx.writeBuffer();
  const arrayBuffer =
    buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer).buffer;
  const filename = `expiring_${validWindow}d_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(arrayBuffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
