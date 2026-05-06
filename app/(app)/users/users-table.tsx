'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDateTime, ROLE_LABEL } from '@/lib/utils';
import { setUserActive, updateUserRole } from './actions';

type Row = {
  id: string;
  email: string;
  display_name: string;
  role: 'master' | 'accounting' | 'viewer';
  is_active: boolean;
  created_at: string;
  deleted_at: string | null;
};

export default function UsersTable({
  users,
  meId,
}: {
  users: Row[];
  meId: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 bg-slate-50">
            <th className="text-left px-4 py-2 font-medium">이메일</th>
            <th className="text-left px-4 py-2 font-medium">표시명</th>
            <th className="text-left px-4 py-2 font-medium">역할</th>
            <th className="text-left px-4 py-2 font-medium">활성</th>
            <th className="text-left px-4 py-2 font-medium">가입일</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                사용자가 없습니다.
              </td>
            </tr>
          )}
          {users.map((u) => (
            <UserRow key={u.id} user={u} isMe={u.id === meId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({ user, isMe }: { user: Row; isMe: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleRole(e: React.ChangeEvent<HTMLSelectElement>) {
    const newRole = e.target.value as Row['role'];
    if (newRole === user.role) return;
    setErr(null);
    start(async () => {
      const r = await updateUserRole({ userId: user.id, role: newRole });
      if (r.error) {
        setErr(r.error);
        e.target.value = user.role;
        return;
      }
      router.refresh();
    });
  }

  function handleActive() {
    setErr(null);
    start(async () => {
      const r = await setUserActive({
        userId: user.id,
        isActive: !user.is_active,
      });
      if (r.error) setErr(r.error);
      else router.refresh();
    });
  }

  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-2">
        <span className="text-slate-900">{user.email}</span>
        {isMe && (
          <span className="ml-2 text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
            본인
          </span>
        )}
        {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
      </td>
      <td className="px-4 py-2 text-slate-700">{user.display_name}</td>
      <td className="px-4 py-2">
        <select
          value={user.role}
          onChange={handleRole}
          disabled={pending}
          className="text-xs border border-slate-300 rounded px-2 py-1 bg-white"
        >
          <option value="master">{ROLE_LABEL.master}</option>
          <option value="accounting">{ROLE_LABEL.accounting}</option>
          <option value="viewer">{ROLE_LABEL.viewer}</option>
        </select>
      </td>
      <td className="px-4 py-2">
        <button
          type="button"
          onClick={handleActive}
          disabled={pending || isMe}
          className={`text-xs px-3 py-1 rounded font-medium ${
            user.is_active
              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
              : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
          } disabled:opacity-50`}
        >
          {user.is_active ? '활성' : '비활성'}
        </button>
      </td>
      <td className="px-4 py-2 text-slate-600 text-xs">
        {fmtDateTime(user.created_at)}
      </td>
    </tr>
  );
}
