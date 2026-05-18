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

export async function searchAll(q: string): Promise<{ hits: SearchHit[]; truncated: boolean }> {
  await requireUser();
  const needle = q.trim();
  if (!needle) return { hits: [], truncated: false };
  if (needle.length < 2) return { hits: [], truncated: false };

  const supabase = await createClient();
  const like = `%${needle.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  // 1) contracts: memo / termination_reason
  // 2) local_governments: full_name / contact_*  → contract ids via local_government_id
  // 3) contract_files: original_filename → contract_id

  const [c1, lgs, fs] = await Promise.all([
    supabase
      .from('contracts')
      .select('id, memo, termination_reason')
      .is('deleted_at', null)
      .or(`memo.ilike.${like},termination_reason.ilike.${like}`)
      .limit(SEARCH_LIMIT),
    supabase
      .from('local_governments')
      .select('id, full_name, contact_department, contact_name, contact_phone, contact_email')
      .is('deleted_at', null)
      .or(
        `full_name.ilike.${like},contact_department.ilike.${like},contact_name.ilike.${like},contact_phone.ilike.${like},contact_email.ilike.${like}`,
      )
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

  for (const r of c1.data ?? []) {
    if (r.memo && r.memo.toLowerCase().includes(needle.toLowerCase())) add(r.id, 'memo');
    if (r.termination_reason && r.termination_reason.toLowerCase().includes(needle.toLowerCase())) add(r.id, 'termination_reason');
  }

  // LG hits → 해당 LG의 모든 활성 계약 id 조회
  const lgHits = lgs.data ?? [];
  if (lgHits.length > 0) {
    const lgIds = lgHits.map((l) => l.id);
    const { data: lgContracts } = await supabase
      .from('contracts')
      .select('id, local_government_id')
      .is('deleted_at', null)
      .in('local_government_id', lgIds);
    const byLg = new Map<string, typeof lgHits[number]>();
    for (const l of lgHits) byLg.set(l.id, l);
    for (const c of lgContracts ?? []) {
      const lg = byLg.get(c.local_government_id);
      if (!lg) continue;
      const n = needle.toLowerCase();
      if (lg.full_name?.toLowerCase().includes(n)) add(c.id, 'lg_name');
      if (lg.contact_department?.toLowerCase().includes(n)) add(c.id, 'contact_department');
      if (lg.contact_name?.toLowerCase().includes(n)) add(c.id, 'contact_name');
      if (lg.contact_phone?.toLowerCase().includes(n)) add(c.id, 'contact_phone');
      if (lg.contact_email?.toLowerCase().includes(n)) add(c.id, 'contact_email');
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
