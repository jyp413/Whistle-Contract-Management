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

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
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

  const supabase = await createClient();

  let query = supabase
    .from('activity_logs')
    .select('id, actor_id, event_type, target_type, target_id, before_value, after_value, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(300);

  if (eventFilter !== 'all') {
    query = query.eq('event_type', eventFilter);
  }

  const { data: logs, error } = await query;

  // Resolve actor display names in one pass
  const actorIds = Array.from(new Set((logs ?? []).map((l) => l.actor_id)));
  const { data: actors } = await supabase
    .from('users')
    .select('id, display_name, email')
    .in('id', actorIds.length ? actorIds : ['00000000-0000-0000-0000-000000000000']);
  const actorMap = new Map((actors ?? []).map((a) => [a.id, a]));

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
      >
        <span aria-hidden>←</span> 대시보드
      </Link>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">활동 로그</h1>
        <p className="text-xs text-slate-500">
          {me.role === 'master' ? '전체 활동' : '본인 활동'} · 최근 300건
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap gap-1">
        {EVENT_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={
              f.key === 'all'
                ? '/activity'
                : `/activity?event=${encodeURIComponent(f.key)}`
            }
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

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
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
                  활동 내역이 없습니다.
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
