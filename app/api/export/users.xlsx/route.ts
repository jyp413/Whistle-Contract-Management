import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/lib/supabase/server';
import { requireMaster } from '@/lib/auth';
import { ROLE_LABEL, fmtDateTime } from '@/lib/utils';

export const runtime = 'nodejs';

export async function GET() {
  const me = await requireMaster();
  const supabase = await createClient();

  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, display_name, role, is_active, created_at, deleted_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = users ?? [];

  const wb = new ExcelJS.Workbook();
  wb.creator = '주차단속 계약관리 시스템';
  wb.created = new Date();

  const ws = wb.addWorksheet('사용자 목록');
  ws.columns = [
    { header: '이메일', key: 'email', width: 30 },
    { header: '표시명', key: 'name', width: 18 },
    { header: '역할', key: 'role', width: 12 },
    { header: '활성', key: 'active', width: 10 },
    { header: '상태', key: 'state', width: 10 },
    { header: '가입일시', key: 'created', width: 20 },
  ];

  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F3864' },
  };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const u of rows) {
    ws.addRow({
      email: u.email,
      name: u.display_name,
      role: ROLE_LABEL[u.role],
      active: u.is_active ? '활성' : '비활성',
      state: u.deleted_at ? '탈퇴' : '정상',
      created: fmtDateTime(u.created_at),
    });
  }

  ws.eachRow({ includeEmpty: false }, (row) => {
    row.alignment = { vertical: 'middle' };
  });

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'zip_download',
    target_type: null,
    after_value: { type: 'excel_export_users', count: rows.length },
  });
  if (logErr) {
    console.error('[users.xlsx] activity_logs insert failed:', logErr);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const arrayBuffer =
    buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer).buffer;
  const filename = `users_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(arrayBuffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
