import type { LgStat } from '@/lib/map/types';
import { RegionMap } from './region-map';

type Props = {
  stats: LgStat[];
};

export function RegionMapCard({ stats }: Props) {
  return (
    <section className="bg-white rounded-lg shadow-sm border border-slate-200">
      <div className="px-5 py-3 border-b border-slate-100 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">지자체별 계약현황</h2>
        <span className="text-xs text-slate-500">광역 → 시·군 → 구 클릭으로 드릴다운</span>
      </div>
      <div className="p-5">
        <RegionMap stats={stats} />
      </div>
    </section>
  );
}
