import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireMaster } from '@/lib/auth';
import UsersTable from './users-table';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const me = await requireMaster();
  const supabase = await createClient();
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, display_name, role, is_active, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
      >
        <span aria-hidden>←</span> 대시보드
      </Link>
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">사용자 관리</h1>
          <p className="text-sm text-slate-500 mt-1">
            Master 권한 전용. 역할 변경 / 활성화 / 삭제 가능.
          </p>
        </div>
        <a
          href="/api/export/users.xlsx"
          className="text-sm font-medium px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 rounded"
        >
          📥 엑셀 내보내기
        </a>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          조회 오류: {error.message}
        </p>
      )}

      <UsersTable
        users={users ?? []}
        meId={me.id}
      />
    </div>
  );
}
