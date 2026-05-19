'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDateTime, ROLE_LABEL } from '@/lib/utils';
import { setUserActive, updateUserRole } from './actions';
import SuccessModal from '@/app/components/success-modal';

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
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-xs text-slate-500 bg-slate-50">
              <th className="text-left px-4 py-2 font-medium">이메일</th>
              <th className="text-left px-4 py-2 font-medium">표시명</th>
              <th className="text-left px-4 py-2 font-medium">역할</th>
              <th className="text-left px-4 py-2 font-medium">활성</th>
              <th className="text-left px-4 py-2 font-medium">가입일</th>
              <th className="text-right px-4 py-2 font-medium">저장</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  사용자가 없습니다.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isMe={u.id === meId}
                onSuccess={() =>
                  setSuccessMsg('사용자 변경이 완료되었습니다.')
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      {successMsg && <SuccessModal message={successMsg} onClose={() => setSuccessMsg(null)} />}
    </>
  );
}

function UserRow({
  user,
  isMe,
  onSuccess,
}: {
  user: Row;
  isMe: boolean;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [draftRole, setDraftRole] = useState(user.role);
  const [draftActive, setDraftActive] = useState(user.is_active);

  const dirty = draftRole !== user.role || draftActive !== user.is_active;

  function reset() {
    setDraftRole(user.role);
    setDraftActive(user.is_active);
    setErr(null);
  }

  function save() {
    setErr(null);
    if (!dirty) return;
    start(async () => {
      if (draftRole !== user.role) {
        const r = await updateUserRole({ userId: user.id, role: draftRole });
        if (r.error) {
          setErr(r.error);
          return;
        }
      }
      if (draftActive !== user.is_active) {
        const r = await setUserActive({
          userId: user.id,
          isActive: draftActive,
        });
        if (r.error) {
          setErr(r.error);
          return;
        }
      }
      onSuccess();
      router.refresh();
    });
  }

  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-2 align-top">
        <span className="text-slate-900">{user.email}</span>
        {isMe && (
          <span className="ml-2 text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
            본인
          </span>
        )}
        {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
      </td>
      <td className="px-4 py-2 text-slate-700 align-top">{user.display_name}</td>
      <td className="px-4 py-2 align-top">
        <select
          value={draftRole}
          onChange={(e) => setDraftRole(e.target.value as Row['role'])}
          disabled={pending}
          className="text-xs border border-slate-300 rounded px-2 py-1 bg-white"
        >
          <option value="master">{ROLE_LABEL.master}</option>
          <option value="accounting">{ROLE_LABEL.accounting}</option>
          <option value="viewer">{ROLE_LABEL.viewer}</option>
        </select>
      </td>
      <td className="px-4 py-2 align-top">
        <select
          value={draftActive ? 'active' : 'inactive'}
          onChange={(e) => setDraftActive(e.target.value === 'active')}
          disabled={pending || isMe}
          className={`text-xs border rounded px-2 py-1 ${
            draftActive
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-slate-50 text-slate-600 border-slate-300'
          } disabled:opacity-50`}
        >
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </select>
      </td>
      <td className="px-4 py-2 text-slate-600 text-xs align-top">
        {fmtDateTime(user.created_at)}
      </td>
      <td className="px-4 py-2 align-top">
        <div className="flex justify-end gap-1">
          {dirty && !pending && (
            <button
              type="button"
              onClick={reset}
              className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1"
            >
              취소
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || pending}
            className={`text-xs font-medium px-3 py-1 rounded ${
              dirty
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            } disabled:opacity-60`}
          >
            {pending ? '저장 중…' : '저장'}
          </button>
        </div>
      </td>
    </tr>
  );
}

