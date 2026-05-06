import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createSupabase } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';

/**
 * Vercel Cron / 외부 스케줄러용. CRON_SECRET 헤더로 인증.
 * 만료 도래(실효 만료일 < 오늘) AND status=completed 인 계약을 일괄 terminated 로 전이.
 * SERVICE_ROLE_KEY 가 환경변수에 있으면 그것으로, 없으면 기존 사용자 컨텍스트로 호출.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const provided =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-cron-secret') ??
    request.nextUrl.searchParams.get('secret');

  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let actorId: string;
  let supabase;

  if (url && serviceKey) {
    supabase = createSupabase<Database>(url, serviceKey, {
      auth: { persistSession: false },
    });
    // 시스템 actor가 필요한데 RPC는 p_actor를 받음. master 계정을 actor로 사용.
    const { data: master } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'master')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!master) {
      return NextResponse.json(
        { error: 'no master user found' },
        { status: 500 },
      );
    }
    actorId = master.id;
  } else {
    // SERVICE_ROLE_KEY 미설정 시 — 사용자 세션 기반 (수동 실행 용도)
    supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'unauthenticated and SUPABASE_SERVICE_ROLE_KEY not set' },
        { status: 401 },
      );
    }
    actorId = user.id;
  }

  const { data, error } = await supabase.rpc('terminate_expired_contracts', {
    p_actor: actorId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ terminated: data });
}
