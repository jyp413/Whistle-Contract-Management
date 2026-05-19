import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireWriter } from '@/lib/auth';
import NewContractForm from './form';

export const dynamic = 'force-dynamic';

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<{ lg?: string }>;
}) {
  await requireWriter();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: lgs } = await supabase
    .from('local_governments')
    .select('id, full_name, sido, sigungu, classification')
    .is('deleted_at', null)
    .order('sido')
    .order('full_name');

  // 미계약 현황 페이지에서 ?lg=<uuid> 로 진입 시 폼이 해당 LG 를 미리 선택
  const initialLgId = sp.lg && lgs?.some((l) => l.id === sp.lg) ? sp.lg : undefined;

  return (
    <div className="max-w-xl mx-auto">
      <Link
        href="/contracts"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 mb-3"
      >
        <span aria-hidden>←</span> 계약 목록
      </Link>
      <h1 className="text-xl font-bold text-slate-900 mb-4">신규 계약 등록</h1>
      <p className="text-sm text-slate-500 mb-4">
        계약사항(지자체·일자)을 등록하면 자동으로 <b>체결중</b> 상태가 됩니다. PDF
        파일은 등록 후 상세 화면에서 업로드합니다.
      </p>
      <NewContractForm localGovernments={lgs ?? []} initialLgId={initialLgId} />
    </div>
  );
}
