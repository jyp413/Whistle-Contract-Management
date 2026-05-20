'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDateTime, ROLE_LABEL } from '@/lib/utils';
import { setUserActive, updateUserRole, deleteUser } from './actions';
import SuccessModal from '@/app/components/success-modal';
import Modal from '@/app/components/modal';

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
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.display_name ?? '').toLowerCase().includes(q),
    );
  }, [users, search]);

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이메일 · 표시명 검색"
          className="w-full sm:w-72 text-sm border border-slate-300 rounded px-3 py-2"
        />
        <span className="text-xs text-slate-500">
          {search.trim()
            ? `${filtered.length}명 검색됨 / 전체 ${users.length}명`
            : `전체 ${users.length}명`}
        </span>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-xs text-slate-500 bg-slate-50">
              <th className="text-left px-4 py-2 font-medium">이메일</th>
              <th className="text-left px-4 py-2 font-medium">표시명</th>
              <th className="text-left px-4 py-2 font-medium">역할</th>
              <th className="text-left px-4 py-2 font-medium">활성</th>
              <th className="text-left px-4 py-2 font-medium">가입일</th>
              <th className="text-right px-4 py-2 font-medium">동작</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  {search.trim()
                    ? '검색 결과가 없습니다.'
                    : '사용자가 없습니다.'}
                </td>
              </tr>
            )}
            {filtered.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isMe={u.id === meId}
                onSuccess={(msg) => setSuccessMsg(msg)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {successMsg && (
        <SuccessModal message={successMsg} onClose={() => setSuccessMsg(null)} />
      )}
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
  onSuccess: (msg: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [draftRole, setDraftRole] = useState(user.role);
  const [draftActive, setDraftActive] = useState(user.is_active);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isDeleted = !!user.deleted_at;
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
      onSuccess('사용자 변경이 완료되었습니다.');
      router.refresh();
    });
  }

  function doDelete() {
    setErr(null);
    start(async () => {
      const r = await deleteUser({ userId: user.id });
      if (r.error) {
        setErr(r.error);
        setConfirmDelete(false);
        return;
      }
      setConfirmDelete(false);
      onSuccess('사용자가 삭제되었습니다.');
      router.refresh();
    });
  }

  return (
    <tr className={`border-t border-slate-100 ${isDeleted ? 'bg-slate-50' : ''}`}>
      <td className="px-4 py-2 align-top">
        <span className={isDeleted ? 'text-slate-400 line-through' : 'text-slate-900'}>
          {user.email}
        </span>
        {isMe && (
          <span className="ml-2 text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
            본인
          </span>
        )}
        {isDeleted && (
          <span className="ml-2 text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded">
            탈퇴
          </span>
        )}
        {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
      </td>
      <td className="px-4 py-2 text-slate-700 align-top">
        {user.display_name}
      </td>
      <td className="px-4 py-2 align-top">
        {isDeleted ? (
          <span className="text-xs text-slate-400">{ROLE_LABEL[user.role]}</span>
        ) : (
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
        )}
      </td>
      <td className="px-4 py-2 align-top">
        {isDeleted ? (
          <span className="text-xs text-slate-400">비활성</span>
        ) : (
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
        )}
      </td>
      <td className="px-4 py-2 text-slate-600 text-xs align-top">
        {fmtDateTime(user.created_at)}
      </td>
      <td className="px-4 py-2 align-top">
        {isDeleted ? (
          <div className="flex justify-end">
            <span className="text-xs text-slate-400">탈퇴 처리됨</span>
          </div>
        ) : (
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
            {!isMe && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
                className="text-xs font-medium px-3 py-1 rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-60"
              >
                삭제
              </button>
            )}
          </div>
        )}
        {confirmDelete && (
          <Modal
            title="사용자 삭제"
            onClose={() => setConfirmDelete(false)}
            maxWidth="sm"
          >
            <p className="text-sm text-slate-700">
              <b className="text-slate-900">{user.email}</b> 사용자를
              삭제하시겠습니까?
            </p>
            <ul className="mt-3 text-xs text-slate-500 list-disc pl-4 space-y-1">
              <li>해당 사용자는 즉시 로그인할 수 없게 됩니다.</li>
              <li>활동 로그 등 기존 기록은 그대로 보존됩니다.</li>
              <li>삭제(탈퇴) 후에는 재활성화할 수 없습니다.</li>
            </ul>
            {err && <p className="text-xs text-red-600 mt-3">{err}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={pending}
                className="text-sm px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
              >
                취소
              </button>
              <button
                type="button"
                onClick={doDelete}
                disabled={pending}
                className="text-sm font-medium px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-60"
              >
                {pending ? '삭제 중…' : '삭제'}
              </button>
            </div>
          </Modal>
        )}
      </td>
    </tr>
  );
}
