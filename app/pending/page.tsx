import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function PendingPage() {
  const me = await getCurrentUser();

  if (!me) redirect('/login');
  if (me.is_active && !me.deleted_at) redirect('/dashboard');

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-sm border p-8 text-center">
        <h1 className="text-xl font-bold text-slate-900">승인 대기 중</h1>
        <p className="text-sm text-slate-600 mt-3 leading-relaxed">
          가입이 완료되었습니다.
          <br />
          시스템 사용을 위해서는 <b>Master 관리자의 승인</b>이 필요합니다.
        </p>
        <div className="mt-6 bg-slate-50 border border-slate-200 rounded p-3 text-left">
          <dl className="text-xs space-y-1">
            <div className="flex justify-between">
              <dt className="text-slate-500">이메일</dt>
              <dd className="text-slate-900 font-mono">{me.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">표시명</dt>
              <dd className="text-slate-900">{me.display_name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">상태</dt>
              <dd className="text-amber-700 font-medium">비활성 (승인 대기)</dd>
            </div>
          </dl>
        </div>
        <p className="text-xs text-slate-500 mt-5">
          관리자에게 위 이메일로 승인을 요청해 주세요. 승인 후에는 본 페이지에서 자동으로
          대시보드로 이동합니다.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="text-sm text-slate-500 hover:text-slate-900 underline-offset-2 hover:underline"
          >
            로그아웃
          </button>
        </form>
      </div>
    </div>
  );
}
