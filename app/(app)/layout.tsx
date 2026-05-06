import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              href="/dashboard"
              className="font-bold text-slate-900 text-sm"
            >
              주차단속 계약관리
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/dashboard"
                className="px-3 py-1.5 rounded text-slate-700 hover:bg-slate-100"
              >
                대시보드
              </Link>
              <Link
                href="/contracts"
                className="px-3 py-1.5 rounded text-slate-700 hover:bg-slate-100"
              >
                계약
              </Link>
              <Link
                href="/expiring"
                className="px-3 py-1.5 rounded text-slate-700 hover:bg-slate-100"
              >
                만료 임박
              </Link>
              {user.role !== 'viewer' && (
                <Link
                  href="/activity"
                  className="px-3 py-1.5 rounded text-slate-700 hover:bg-slate-100"
                >
                  활동 로그
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-slate-700">
              {user.display_name}{' '}
              <span className="text-slate-400">({ROLE_LABEL[user.role]})</span>
            </span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="text-slate-500 hover:text-slate-900 underline-offset-2 hover:underline"
              >
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        {children}
      </main>
    </div>
  );
}
