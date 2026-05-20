import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { fmtDateTime } from '@/lib/utils';
import type { Database } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

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

const EVENT_FILTERS: { key: EventType | 'all'; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'contract_create', label: '계약 등록' },
  { key: 'status_change', label: '상태 변경' },
  { key: 'extension', label: '연장' },
  { key: 'correction', label: '보정' },
  { key: 'file_upload', label: '파일 업로드' },
];

const PAGE_SIZES = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

// event / size / page 를 보존·변경하며 querystring 을 만든다.
function activityUrl(opts: { event: string; size: number; page: number }) {
  const params = new URLSearchParams();
  if (opts.event !== 'all') params.set('event', opts.event);
  if (opts.size !== DEFAULT_PAGE_SIZE) params.set('size', String(opts.size));
  if (opts.page > 1) params.set('page', String(opts.page));
  const qs = params.toString();
  return qs ? `/activity?${qs}` : '/activity';
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; page?: string; size?: string }>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const eventFilter = (sp.event ?? 'all') as EventType | 'all';

  if (me.role === 'viewer') {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3 rounded">
        활동 로그는 Master / Accounting 권한에서만 조회할 수 있습니다.
      </div>
    );
  }

  const sizeRaw = parseInt(sp.size ?? '', 10);
  const size: (typeof PAGE_SIZES)[number] = (
    PAGE_SIZES as readonly number[]
  ).includes(sizeRaw)
    ? (sizeRaw as (typeof PAGE_SIZES)[number])
    : DEFAULT_PAGE_SIZE;
  const pageRaw = parseInt(sp.page ?? '1', 10);
  const requestedPage = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const supabase = await createClient();

  const from = (requestedPage - 1) * size;
  const to = from + size - 1;

  let query = supabase
    .from('activity_logs')
    .select(
      'id, actor_id, event_type, target_type, target_id, before_value, after_value, occurred_at',
      { count: 'exact' },
    )
    .order('occurred_at', { ascending: false })
    .range(from, to);

  if (eventFilter !== 'all') {
    query = query.eq('event_type', eventFilter);
  }

  const { data: logs, error, count } = await query;

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages);

  // Resolve actor display names in one pass
  const actorIds = Array.from(new Set((logs ?? []).map((l) => l.actor_id)));
  const { data: actors } = await supabase
    .from('users')
    .select('id, display_name, email')
    .in('id', actorIds.length ? actorIds : ['00000000-0000-0000-0000-000000000000']);
  const actorMap = new Map((actors ?? []).map((a) => [a.id, a]));

  const exportHref =
    eventFilter === 'all'
      ? '/api/export/activity.xlsx'
      : `/api/export/activity.xlsx?event=${encodeURIComponent(eventFilter)}`;

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
      >
        <span aria-hidden>←</span> 대시보드
      </Link>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">활동 로그</h1>
          <p className="text-xs text-slate-500 mt-1">
            {me.role === 'master' ? '전체 활동' : '본인 활동'} · 총{' '}
            {total.toLocaleString()}건
          </p>
        </div>
        <a
          href={exportHref}
          className="text-sm font-medium px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 rounded"
        >
          📥 엑셀 내보내기
        </a>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap gap-1">
        {EVENT_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={activityUrl({ event: f.key, size, page: 1 })}
            className={`text-xs px-3 py-1.5 rounded border ${
              eventFilter === f.key
                ? 'bg-slate-900 border-slate-900 text-white'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          조회 오류: {error.message}
        </p>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-xs text-slate-500 bg-slate-50">
              <th className="text-left px-4 py-2 font-medium">발생일시</th>
              <th className="text-left px-4 py-2 font-medium">사용자</th>
              <th className="text-left px-4 py-2 font-medium">이벤트</th>
              <th className="text-left px-4 py-2 font-medium">대상</th>
              <th className="text-left px-4 py-2 font-medium">전 → 후</th>
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  {error ? '활동 내역을 불러올 수 없습니다.' : '활동 내역이 없습니다.'}
                </td>
              </tr>
            )}
            {(logs ?? []).map((l) => {
              const actor = actorMap.get(l.actor_id);
              return (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-600 text-xs whitespace-nowrap">
                    {fmtDateTime(l.occurred_at)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {actor?.display_name ?? '-'}
                    <span className="block text-[10px] text-slate-400">
                      {actor?.email ?? l.actor_id.slice(0, 8) + '…'}
                    </span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {EVENT_LABEL[l.event_type] ?? l.event_type}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {l.target_type && l.target_id ? (
                      l.target_type === 'contract' ? (
                        <Link
                          href={`/contracts/${l.target_id}`}
                          className="font-mono text-indigo-600 hover:underline"
                        >
                          {l.target_type}: {l.target_id.slice(0, 8)}…
                        </Link>
                      ) : (
                        <span className="font-mono text-slate-500">
                          {l.target_type}: {l.target_id.slice(0, 8)}…
                        </span>
                      )
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-700 max-w-md">
                    <Diff before={l.before_value} after={l.after_value} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 — 1건 이상이면 항상 표시 */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-slate-500">
            총 {total.toLocaleString()}건 ·{' '}
            <b className="text-slate-700 tabular-nums">{currentPage}</b> /{' '}
            {totalPages} 페이지
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-slate-500">페이지당</span>
              {PAGE_SIZES.map((s) => (
                <Link
                  key={s}
                  href={activityUrl({ event: eventFilter, size: s, page: 1 })}
                  scroll={false}
                  className={`px-2 py-1 rounded border tabular-nums ${
                    size === s
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {s}
                </Link>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {currentPage > 1 ? (
                <Link
                  href={activityUrl({
                    event: eventFilter,
                    size,
                    page: currentPage - 1,
                  })}
                  scroll={false}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
                  aria-label="이전 페이지"
                >
                  ‹ 이전
                </Link>
              ) : (
                <span className="px-2.5 py-1 rounded border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed">
                  ‹ 이전
                </span>
              )}
              <span className="px-2 text-slate-500 tabular-nums">
                {currentPage} / {totalPages}
              </span>
              {currentPage < totalPages ? (
                <Link
                  href={activityUrl({
                    event: eventFilter,
                    size,
                    page: currentPage + 1,
                  })}
                  scroll={false}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
                  aria-label="다음 페이지"
                >
                  다음 ›
                </Link>
              ) : (
                <span className="px-2.5 py-1 rounded border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed">
                  다음 ›
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Diff({
  before,
  after,
}: {
  before: unknown;
  after: unknown;
}) {
  if (!before && !after) return <span className="text-slate-400">-</span>;
  return (
    <div className="space-y-0.5 font-mono text-[11px]">
      {before ? (
        <div className="text-rose-700">- {summarize(before)}</div>
      ) : null}
      {after ? (
        <div className="text-emerald-700">+ {summarize(after)}</div>
      ) : null}
    </div>
  );
}

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
