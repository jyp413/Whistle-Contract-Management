import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import type { LgStat, LgClass } from '@/lib/map/types';

export const dynamic = 'force-dynamic';

const CLASS_LABEL: Record<LgClass, string> = {
  si: '시',
  gun: '군',
  gu: '구',
};

const CLASS_BADGE: Record<LgClass, string> = {
  si: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  gun: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  gu: 'bg-violet-50 text-violet-700 ring-violet-600/20',
};

const CLASS_FILTERS: { key: LgClass | 'all'; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'si', label: '시' },
  { key: 'gun', label: '군' },
  { key: 'gu', label: '구' },
];

export default async function UncontractedPage({
  searchParams,
}: {
  searchParams: Promise<{ cls?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const clsFilter = (['si', 'gun', 'gu'] as const).includes(sp.cls as LgClass)
    ? (sp.cls as LgClass)
    : 'all';

  const supabase = await createClient();
  const { data: statsRaw, error: statsErr } = await supabase.rpc('get_region_stats');
  const stats: LgStat[] = (statsRaw ?? []) as LgStat[];

  // "미계약" = 살아있는(=종료 제외) 메인 계약이 0건. get_region_stats 는 메인만 카운트.
  const uncontracted = stats.filter(
    (s) => s.completed + s.in_progress + s.updating === 0,
  );
  const totalLgs = stats.length;
  const uncontractedCount = uncontracted.length;
  const contractedCount = totalLgs - uncontractedCount;
  const contractedRate = totalLgs > 0 ? (contractedCount / totalLgs) * 100 : 0;

  // 담당자 정보 join (미계약 LG 만)
  const uncontractedIds = uncontracted.map((s) => s.lg_id);
  const contactMap = new Map<
    string,
    { name: string | null; phone: string | null; email: string | null }
  >();
  if (uncontractedIds.length > 0) {
    const { data: lgs } = await supabase
      .from('local_governments')
      .select('id, contact_name, contact_phone, contact_email')
      .in('id', uncontractedIds);
    for (const l of lgs ?? []) {
      contactMap.set(l.id, {
        name: l.contact_name,
        phone: l.contact_phone,
        email: l.contact_email,
      });
    }
  }

  // 분류 필터 적용
  const filtered = clsFilter === 'all'
    ? uncontracted
    : uncontracted.filter((s) => s.classification === clsFilter);

  // 시도별 그룹화 (시도 안에서는 분류 → 이름 정렬)
  const bySido = new Map<string, LgStat[]>();
  for (const s of filtered) {
    const arr = bySido.get(s.sido) ?? [];
    arr.push(s);
    bySido.set(s.sido, arr);
  }
  const sortedSidos = Array.from(bySido.keys()).sort((a, b) =>
    a.localeCompare(b, 'ko'),
  );
  for (const sido of sortedSidos) {
    const arr = bySido.get(sido)!;
    arr.sort((a, b) => {
      const cls = a.classification.localeCompare(b.classification);
      if (cls !== 0) return cls;
      return a.sigungu.localeCompare(b.sigungu, 'ko');
    });
  }

  // 분류별 카운트 (요약 카드용 — 전체 미계약 기준)
  const countsByClass = uncontracted.reduce(
    (acc, s) => {
      acc[s.classification] = (acc[s.classification] ?? 0) + 1;
      return acc;
    },
    { si: 0, gun: 0, gu: 0 } as Record<LgClass, number>,
  );

  return (
    <div className="space-y-5">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
      >
        <span aria-hidden>←</span> 대시보드
      </Link>

      <div>
        <h1 className="text-xl font-bold text-slate-900">미계약 현황</h1>
        <p className="text-sm text-slate-500 mt-1">
          살아있는 메인 계약이 없는 지자체 목록 — 신규 영업·연락 대상
        </p>
      </div>

      {statsErr && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          조회 오류: {statsErr.message}
        </p>
      )}

      {/* 진행률 + 미계약 총합 카드 */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <p className="text-sm text-slate-700">
            <b className="text-2xl text-rose-600 tabular-nums">
              {uncontractedCount}
            </b>
            <span className="ml-1">건 미계약</span>
            <span className="text-slate-400 mx-2">/</span>
            <span className="text-slate-500 tabular-nums">전체 {totalLgs}건</span>
          </p>
          <p className="text-xs text-slate-500 tabular-nums">
            계약률 {contractedRate.toFixed(1)}% ({contractedCount} / {totalLgs})
          </p>
        </div>
        <div className="h-2 bg-slate-100 rounded overflow-hidden">
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${contractedRate}%` }}
            aria-label={`계약률 ${contractedRate.toFixed(1)}%`}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 pt-1">
          {(['si', 'gun', 'gu'] as LgClass[]).map((c) => (
            <div
              key={c}
              className="text-center px-3 py-2 rounded border border-slate-200 bg-slate-50"
            >
              <p className="text-[11px] text-slate-500">{CLASS_LABEL[c]}</p>
              <p className="text-lg font-semibold text-slate-900 tabular-nums">
                {countsByClass[c]}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 분류 필터 */}
      <div className="flex flex-wrap gap-1">
        <span className="text-xs text-slate-500 self-center pr-1">분류</span>
        {CLASS_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === 'all' ? '/uncontracted' : `/uncontracted?cls=${f.key}`}
            className={`text-xs px-3 py-1.5 rounded border ${
              clsFilter === f.key
                ? 'bg-slate-900 border-slate-900 text-white'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {f.label}
            {f.key !== 'all' && (
              <span className="ml-1 text-[10px] opacity-60 tabular-nums">
                {countsByClass[f.key]}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* 시도별 그룹 리스트 */}
      {sortedSidos.length === 0 ? (
        <p className="bg-white border border-slate-200 rounded-lg px-5 py-10 text-center text-sm text-slate-400">
          {statsErr ? '데이터를 불러올 수 없습니다.' : '해당 분류의 미계약 지자체가 없습니다.'}
        </p>
      ) : (
        <div className="space-y-3">
          {sortedSidos.map((sido) => {
            const items = bySido.get(sido)!;
            return (
              <section
                key={sido}
                className="bg-white border border-slate-200 rounded-lg overflow-hidden"
              >
                <header className="px-4 py-2 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <h2 className="text-sm font-semibold text-slate-900">{sido}</h2>
                  <span className="text-xs text-slate-500 tabular-nums">{items.length}건</span>
                </header>
                <ul className="divide-y divide-slate-100">
                  {items.map((s) => {
                    const contact = contactMap.get(s.lg_id);
                    const hasContact = !!(
                      contact?.name ||
                      contact?.phone ||
                      contact?.email
                    );
                    return (
                      <li
                        key={s.lg_id}
                        className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50"
                      >
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="text-sm text-slate-900 truncate">
                            {s.full_name}
                          </span>
                          <span
                            className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ring-1 ring-inset ${CLASS_BADGE[s.classification]}`}
                          >
                            {CLASS_LABEL[s.classification]}
                          </span>
                          {s.terminated > 0 && (
                            <span
                              className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-600/20"
                              title="과거 종료된 계약이 있음"
                            >
                              종료 이력 {s.terminated}
                            </span>
                          )}
                          {!hasContact && (
                            <span
                              className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ring-1 ring-inset bg-rose-50 text-rose-700 ring-rose-600/20"
                              title="LG 담당자 정보 미등록 — 영업 액션 전에 담당자 정보를 등록하세요"
                            >
                              📞 담당자 미등록
                            </span>
                          )}
                        </div>
                        <Link
                          href={`/contracts/new?lg=${s.lg_id}`}
                          className="text-xs font-medium px-3 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded whitespace-nowrap"
                        >
                          + 신규 등록
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
