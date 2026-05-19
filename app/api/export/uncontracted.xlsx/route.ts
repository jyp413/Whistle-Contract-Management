import { NextResponse, type NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/lib/supabase/server';
import { requireWriter } from '@/lib/auth';
import type { LgStat, LgClass } from '@/lib/map/types';

export const runtime = 'nodejs';

const CLASS_LABEL: Record<LgClass, string> = {
  si: '시',
  gun: '군',
  gu: '구',
};

/**
 * 미계약 현황 Excel export — /uncontracted 페이지의 데이터 추출.
 * ?cls=si|gun|gu (default 전체). 시도별로 정렬, 시도 내에서 분류 → 이름 순.
 */
export async function GET(request: NextRequest) {
  const me = await requireWriter();
  const supabase = await createClient();

  const url = new URL(request.url);
  const clsRaw = url.searchParams.get('cls');
  const clsFilter: LgClass | 'all' = (['si', 'gun', 'gu'] as const).includes(
    clsRaw as LgClass,
  )
    ? (clsRaw as LgClass)
    : 'all';

  const { data: statsRaw, error: statsErr } = await supabase.rpc('get_region_stats');
  if (statsErr) {
    return NextResponse.json({ error: statsErr.message }, { status: 500 });
  }
  const stats: LgStat[] = (statsRaw ?? []) as LgStat[];

  // 살아있는 메인 계약 0건 = 미계약
  let uncontracted = stats.filter(
    (s) => s.completed + s.in_progress + s.updating === 0,
  );
  if (clsFilter !== 'all') {
    uncontracted = uncontracted.filter((s) => s.classification === clsFilter);
  }

  // 시도 → 분류 → 이름 순 정렬
  uncontracted.sort((a, b) => {
    const sido = a.sido.localeCompare(b.sido, 'ko');
    if (sido !== 0) return sido;
    const cls = a.classification.localeCompare(b.classification);
    if (cls !== 0) return cls;
    return a.sigungu.localeCompare(b.sigungu, 'ko');
  });

  // 시도별 NO 순번
  const noBySido = new Map<string, number>();

  const wb = new ExcelJS.Workbook();
  wb.creator = '주차단속 계약관리 시스템';
  wb.created = new Date();

  const ws = wb.addWorksheet(
    clsFilter === 'all' ? '미계약 현황' : `미계약 ${CLASS_LABEL[clsFilter]}`,
  );
  ws.columns = [
    { header: '시도', key: 'sido', width: 18 },
    { header: 'No', key: 'no', width: 6 },
    { header: '지자체', key: 'lg', width: 26 },
    { header: '분류', key: 'cls', width: 8 },
    { header: '종료 이력', key: 'terminated', width: 10 },
    { header: 'LG ID', key: 'id', width: 38 },
  ];

  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F3864' },
  };

  for (const s of uncontracted) {
    const next = (noBySido.get(s.sido) ?? 0) + 1;
    noBySido.set(s.sido, next);
    ws.addRow({
      sido: s.sido,
      no: next,
      lg: s.full_name,
      cls: CLASS_LABEL[s.classification],
      terminated: s.terminated > 0 ? s.terminated : '',
      id: s.lg_id,
    });
  }

  ws.eachRow({ includeEmpty: false }, (row) => {
    row.alignment = { vertical: 'middle' };
  });

  // 요약 시트
  const summary = wb.addWorksheet('요약');
  const totalLgs = stats.length;
  const uncontractedTotal = stats.filter(
    (s) => s.completed + s.in_progress + s.updating === 0,
  ).length;
  const contractedTotal = totalLgs - uncontractedTotal;
  const rate = totalLgs > 0 ? (contractedTotal / totalLgs) * 100 : 0;
  summary.addRow(['생성일시', new Date().toISOString()]);
  summary.addRow(['분류 필터', clsFilter === 'all' ? '전체' : CLASS_LABEL[clsFilter]]);
  summary.addRow(['전체 지자체', totalLgs]);
  summary.addRow(['계약 지자체', contractedTotal]);
  summary.addRow(['미계약 지자체 (전체)', uncontractedTotal]);
  summary.addRow(['미계약 (필터 적용)', uncontracted.length]);
  summary.addRow(['계약률 (%)', Number(rate.toFixed(1))]);
  summary.getColumn(1).width = 22;
  summary.getColumn(2).width = 28;
  summary.getColumn(1).font = { bold: true };

  const { error: logErr } = await supabase.from('activity_logs').insert({
    actor_id: me.id,
    event_type: 'zip_download',
    target_type: null,
    after_value: {
      type: 'excel_export_uncontracted',
      cls: clsFilter,
      count: uncontracted.length,
    },
  });
  if (logErr) console.error('[uncontracted.xlsx] activity_logs insert failed:', logErr);

  const buffer = await wb.xlsx.writeBuffer();
  const arrayBuffer =
    buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer).buffer;
  const suffix = clsFilter === 'all' ? '' : `_${clsFilter}`;
  const filename = `uncontracted${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(arrayBuffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
