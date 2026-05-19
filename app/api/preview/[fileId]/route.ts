import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';

/**
 * 파일 미리보기 프록시 — 세션 바인딩된 URL로 PDF 접근.
 * - writer (master / accounting): 짧은 TTL 의 Storage signed URL 로 302 redirect → 빠른 다운로드/뷰
 * - viewer: 서버가 바이트를 inline 으로 스트리밍 (URL 공유로 외부 유출 차단).
 *
 * 클라이언트에서 supabase.storage.createSignedUrl 을 직접 호출하면 발급된 URL 이 5분간 공용
 * 자원으로 노출돼 뷰어가 curl/새 탭으로 그대로 다운로드 가능 — 이를 차단하기 위한 라우트.
 * RLS 가 contract_files SELECT 를 제한하므로 fileId 로 행을 불러오면 권한 외 파일은 자연 차단.
 */
export const runtime = 'nodejs';

const SIGNED_URL_TTL_SECONDS = 60 * 5;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const me = await requireUser();
  const { fileId } = await params;

  const supabase = await createClient();
  const { data: file, error } = await supabase
    .from('contract_files')
    .select('id, storage_path, original_filename')
    .eq('id', fileId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !file) {
    return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
  }

  // Writer: 직접 signed URL 로 redirect (다운로드/뷰 모두 빠름)
  if (me.role === 'master' || me.role === 'accounting') {
    const { data: signed, error: sErr } = await supabase.storage
      .from('contract-files')
      .createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS);
    if (sErr || !signed) {
      return NextResponse.json(
        { error: sErr?.message ?? 'URL 발급 실패' },
        { status: 500 },
      );
    }
    return NextResponse.redirect(signed.signedUrl, 302);
  }

  // Viewer: 바이트를 inline 으로 프록시 — 발급 URL 자체를 외부에 공유 불가
  const { data: blob, error: dErr } = await supabase.storage
    .from('contract-files')
    .download(file.storage_path);
  if (dErr || !blob) {
    return NextResponse.json(
      { error: dErr?.message ?? '다운로드 실패' },
      { status: 500 },
    );
  }

  const dispositionFilename = encodeURIComponent(file.original_filename);
  return new NextResponse(blob.stream() as unknown as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${dispositionFilename}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
