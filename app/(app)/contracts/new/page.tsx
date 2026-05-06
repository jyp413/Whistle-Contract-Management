import { createClient } from '@/lib/supabase/server';
import { requireWriter } from '@/lib/auth';
import NewContractForm from './form';

export const dynamic = 'force-dynamic';

export default async function NewContractPage() {
  await requireWriter();
  const supabase = await createClient();
  const { data: lgs } = await supabase
    .from('local_governments')
    .select('id, full_name, classification')
    .is('deleted_at', null)
    .order('full_name');

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-4">신규 계약 등록</h1>
      <p className="text-sm text-slate-500 mb-4">
        계약사항(지자체·일자)을 등록하면 자동으로 <b>체결중</b> 상태가 됩니다. PDF
        파일은 등록 후 상세 화면에서 업로드합니다.
      </p>
      <NewContractForm localGovernments={lgs ?? []} />
    </div>
  );
}
