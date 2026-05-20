'use server';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { effectiveExpiry } from '@/lib/utils';

export type SearchMatch =
  | 'lg_name'
  | 'memo'
  | 'termination_reason'
  | 'contact_department'
  | 'contact_name'
  | 'contact_phone'
  | 'contact_email'
  | 'filename';

export type SearchHit = {
  contract_id: string;
  lg_name: string;
  contract_type: string;
  contracting_party: string;
  status: string;
  is_main: boolean;
  signed_date: string | null;
  effective_expiry: string | null;
  matches: SearchMatch[];
};

const SEARCH_LIMIT = 100;
const SEARCH_MAX_LEN = 100;

export async function searchAll(q: string): Promise<{ hits: SearchHit[]; truncated: boolean }> {
  await requireUser();
  const needle = q.trim();
  if (!needle) return { hits: [], truncated: false };
  if (needle.length < 2) return { hits: [], truncated: false };
  if (needle.length > SEARCH_MAX_LEN) return { hits: [], truncated: false };

  const supabase = await createClient();
  // LIKE 메타문자만 이스케이프. PostgREST .or() 문자열 템플릿 회피를 위해 컬럼별 .ilike() 체인을
  // Promise.all 로 병렬 실행한다 (CSV 구분자 ',' '(' ')' '.' 등이 needle 에 들어가도 안전).
  const like = `%${needle.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

  // 1) contracts: memo / termination_reason / contact_*  (담당자는 계약 단위 — 직접 hit)
  // 2) local_governments: full_name  → contract ids via local_government_id
  // 3) contract_files: original_filename → contract_id

  const [cMemo, cTerm, cDept, cPerson, cPhone, cEmail, lgName, fs] = await Promise.all([
    supabase
      .from('contracts')
      .select('id, memo')
      .is('deleted_at', null)
      .ilike('memo', like)
      .limit(SEARCH_LIMIT),
    supabase
      .from('contracts')
      .select('id, termination_reason')
      .is('deleted_at', null)
      .ilike('termination_reason', like)
      .limit(SEARCH_LIMIT),
    supabase
      .from('contracts')
      .select('id, contact_department')
      .is('deleted_at', null)
      .ilike('contact_department', like)
      .limit(SEARCH_LIMIT),
    supabase
      .from('contracts')
      .select('id, contact_name')
      .is('deleted_at', null)
      .ilike('contact_name', like)
      .limit(SEARCH_LIMIT),
    supabase
      .from('contracts')
      .select('id, contact_phone')
      .is('deleted_at', null)
      .ilike('contact_phone', like)
      .limit(SEARCH_LIMIT),
    supabase
      .from('contracts')
      .select('id, contact_email')
      .is('deleted_at', null)
      .ilike('contact_email', like)
      .limit(SEARCH_LIMIT),
    supabase
      .from('local_governments')
      .select('id, full_name')
      .is('deleted_at', null)
      .ilike('full_name', like)
      .limit(SEARCH_LIMIT),
    supabase
      .from('contract_files')
      .select('contract_id, original_filename')
      .is('deleted_at', null)
      .ilike('original_filename', like)
      .limit(SEARCH_LIMIT),
  ]);

  const matchMap = new Map<string, Set<SearchMatch>>();

  function add(id: string, m: SearchMatch) {
    let s = matchMap.get(id);
    if (!s) {
      s = new Set();
      matchMap.set(id, s);
    }
    s.add(m);
  }

  for (const r of cMemo.data ?? []) add(r.id, 'memo');
  for (const r of cTerm.data ?? []) add(r.id, 'termination_reason');
  // 담당자는 계약 단위 — contract id 직접 hit
  for (const r of cDept.data ?? []) add(r.id, 'contact_department');
  for (const r of cPerson.data ?? []) add(r.id, 'contact_name');
  for (const r of cPhone.data ?? []) add(r.id, 'contact_phone');
  for (const r of cEmail.data ?? []) add(r.id, 'contact_email');

  // LG hits (full_name) → 해당 LG의 모든 활성 계약 id 조회
  const lgMatches = new Map<string, Set<SearchMatch>>();
  function addLg(lgId: string, m: SearchMatch) {
    let s = lgMatches.get(lgId);
    if (!s) {
      s = new Set();
      lgMatches.set(lgId, s);
    }
    s.add(m);
  }
  for (const r of lgName.data ?? []) addLg(r.id, 'lg_name');

  if (lgMatches.size > 0) {
    const lgIds = Array.from(lgMatches.keys());
    const { data: lgContracts } = await supabase
      .from('contracts')
      .select('id, local_government_id')
      .is('deleted_at', null)
      .in('local_government_id', lgIds);
    for (const c of lgContracts ?? []) {
      const labels = lgMatches.get(c.local_government_id);
      if (!labels) continue;
      for (const m of labels) add(c.id, m);
    }
  }

  for (const f of fs.data ?? []) add(f.contract_id, 'filename');

  if (matchMap.size === 0) return { hits: [], truncated: false };

  // 매치된 contract 메타 조회
  const ids = Array.from(matchMap.keys()).slice(0, SEARCH_LIMIT);
  const truncated = matchMap.size > SEARCH_LIMIT;
  const { data: rows } = await supabase
    .from('contracts')
    .select(
      'id, status, contract_type, contracting_party, master_contract_id, signed_date, expiry_date, extended_expiry_date, auto_renewal, auto_renewal_period_months, auto_renewal_end_date, local_governments(full_name)',
    )
    .is('deleted_at', null)
    .in('id', ids);

  const hits: SearchHit[] = (rows ?? []).map((r) => ({
    contract_id: r.id,
    lg_name: r.local_governments?.full_name ?? '-',
    contract_type: r.contract_type,
    contracting_party: r.contracting_party,
    status: r.status,
    is_main: !r.master_contract_id,
    signed_date: r.signed_date,
    effective_expiry: effectiveExpiry(r),
    matches: Array.from(matchMap.get(r.id) ?? []),
  }));
  // lg_name → signed_date desc 보조 정렬
  hits.sort((a, b) => {
    const cmp = a.lg_name.localeCompare(b.lg_name, 'ko');
    if (cmp !== 0) return cmp;
    return (b.signed_date ?? '').localeCompare(a.signed_date ?? '');
  });

  return { hits, truncated };
}
