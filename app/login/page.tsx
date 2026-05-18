import Image from 'next/image';
import Link from 'next/link';
import LoginForm from './login-form';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-sm border p-8">
        <Image
          src="/logo-whistle.png"
          alt="휘슬"
          width={89}
          height={48}
          priority
          className="mb-4 h-10 w-auto"
        />
        <h1 className="text-xl font-bold text-slate-900 mb-1">계약관리 시스템</h1>
        <p className="text-sm text-slate-500 mb-6">로그인 후 이용 가능합니다.</p>
        <LoginForm />
        <p className="text-xs text-slate-500 mt-6 text-center">
          계정이 없나요?{' '}
          <Link href="/signup" className="text-indigo-600 hover:underline">
            회원가입
          </Link>
        </p>
      </div>
    </div>
  );
}
