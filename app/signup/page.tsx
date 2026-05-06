import Link from 'next/link';
import SignupForm from './signup-form';

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-sm border p-8">
        <h1 className="text-xl font-bold text-slate-900 mb-1">회원가입</h1>
        <p className="text-sm text-slate-500 mb-6">
          가입 직후 기본 권한은 <b>Viewer</b>입니다. 권한 상향은 Master에게 요청하세요.
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
