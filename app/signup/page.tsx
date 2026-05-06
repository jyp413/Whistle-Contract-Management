import Link from 'next/link';
import SignupForm from './signup-form';

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-sm border p-8">
        <h1 className="text-xl font-bold text-slate-900 mb-1">회원가입</h1>
        <p className="text-sm text-slate-500 mb-6 leading-relaxed">
          가입 후 <b>Master 관리자의 승인</b>이 있어야 시스템을 사용할 수 있습니다.
          <br />
          승인 시 기본 권한은 <b>Viewer</b>이며, 필요 시 Master가 권한을 상향합니다.
        </p>
        <SignupForm />
        <p className="text-xs text-slate-500 mt-6 text-center">
          이미 계정이 있나요?{' '}
          <Link href="/login" className="text-indigo-600 hover:underline">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
