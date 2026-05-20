import { NextResponse, type NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/lib/supabase/server';
import { requireWriter } from '@/lib/auth';
import { fmtDateTime } from '@/lib/utils';
import type { Database } from '@/lib/types/database';

export const runtime = 'nodejs';

type EventType = Database['public']['Enums']['event_type'];

const EVENT_LABEL: Record<EventType, string> = {
  login: '로그인',
  logout: '로그아웃',
  contract_create: '계약 등록',
  contract_update: '계약 수정',
  contract_delete: '계약 삭제',
  status_change: '상태 변경',
  extension: '계약기간 연장',
  correction: '상태 보정',
  file_upload: '파일 업로드',
  file_download: '파일 다운로드',
  file_delete: '파일 삭제',
  zip_download: 'ZIP 다운로드',
  permission_change: '권한 변경',
  meta_update: '계약 정보 수정',
  cascade_terminate: '부속 자동 종료',
};

// 감사 로그는 무한 증가하므로 내보내기 상한을 둔다.
const MAX_ROWS = 5000;

function summarize(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return '[object]';
  }
}

export async function GET(request: NextRequest) {
  const me = await requireWriter();
  const supabase = await createClient();

  const url = new URL(request.url);
  const event = url.searchParams.get('event')?.trim() || 'all';

  let query = supabase
    .from('activity_logs')
    .select(
      'id, actor_id, event_type, target_type, target_id, before_value, after_value, occurred_at',
    )
    .order('occurred_at', { ascending: false })
    .limit(MAX_ROWS);

  if (event !== 'all') {
    query = query.eq('event_type', event as EventType);
  }

  const { data: logs, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = logs ?? [];

  // 사용자 표시명 일괄 조회
  const actorIds = Array.from(new Set(rows.map((l) => l.actor_id)));
  const { data: actors } = await supabase
    .from('users')
    .select('id, display_name, email')
    .in('id', actorIds.length ? actorIds : ['00000000-0000-0000-0000-000000000000']);
  const actorMap = new Map((actors ?? []).map((a) => [a.id, a]));

  const wb = new ExcelJS.Workbook();
  wb.creator = '주차단속 계약관리 시스템';
  wb.created = new Date();

  const ws = wb.addWorksheet('활동 로그');
  ws.columns = [
    { header: '발생일시', key: 'occurred', width: 20 },
    { header: '사용자', key: 'actor', width: 16 },
    { header: '이메일', key: 'email', width: 28 },
    { header: '이벤트', key: 'event', width: 16 },
    { header: '대상 유형', key: 'targetType', width: 12 },
    { header: '대상 ID', key: 'targetId', width: 38 },
    { header: '변경 전', key: 'before', width: 44 },
    { header: '변경 후', key: 'after', width: 44 },
  ];

  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F3864' },
  };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const l of rows) {
    const actor = actorMap.get(l.actor_id);
    ws.addRow({
      occurred: fmtDateTime(l.occurred_at),
      actor: actor?.display_name ?? '-',
      email: actor?.email ?? l.actor_id,
      event: EVENT_LABEL[l.event_type] ?? l.event_type,
      targetType: l.target_type ?? '',
      targetId: l.target_id ?? '',
      before: summarize(l.before_value),
      after: summarize(l.after_value),
    });
  }

  ws.eachRow({ includeEmpty: false }, (row) => {
    row.alignment = { vertical: 'middle' };
  });

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'zip_download',
    target_type: null,
    after_value: {
      type: 'excel_export_activity',
      filter: { event },
      count: rows.length,
    },
  });
  if (logErr) {
    console.error('[activity.xlsx] activity_logs insert failed:', logErr);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const arrayBuffer =
    buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer).buffer;
  const filename = `activity_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(arrayBuffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
