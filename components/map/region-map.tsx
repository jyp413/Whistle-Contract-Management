'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { feature, merge } from 'topojson-client';
import type {
  Topology,
  GeometryCollection,
  Polygon as TopoPolygon,
  MultiPolygon as TopoMultiPolygon,
} from 'topojson-specification';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { LgStat, View } from '@/lib/map/types';
import {
  splitPolygonName,
  rollup,
  SIDO_BY_GEO_CODE,
} from '@/lib/map/derive';
import { coverageRate, fmtPct, partyColor, partyTint, TINT_LABEL } from '@/lib/map/rate';
import { sumParty } from '@/lib/map/aggregate-by-sido';
import {
  lgsByGeoCode,
  lgsByParentSi,
  lgsBySidoCode,
} from '@/lib/map/match';
import { RegionLeafPanel, type LeafSelection } from './region-leaf-panel';
import { RegionNationPanel } from './region-nation-panel';
import { RegionBreadcrumb } from './region-breadcrumb';

type GeoProps = { name: string; code: string };
type GeoFeature = Feature<Polygon | MultiPolygon, GeoProps>;

type ViewFeature = {
  /** stable id for React key */
  key: string;
  /** label shown on/below the polygon */
  label: string;
  /** GeoJSON geometry to render */
  feature: GeoFeature;
  /** LG rows that belong to this polygon */
  lgs: LgStat[];
  /** click behavior */
  drillTo?: View;
  /** leaf info to show in side panel */
  leaf?: LeafSelection;
};

type Props = {
  stats: LgStat[];
};

const TOPO_URL = '/geo/korea-admin.topo.json';

export function RegionMap({ stats }: Props) {
  const [topo, setTopo] = useState<Topology | null>(null);
  const [view, setView] = useState<View>({ level: 'nation' });
  const [hovered, setHovered] = useState<string | null>(null);
  const [leaf, setLeaf] = useState<LeafSelection | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 600, h: 720 });

  useEffect(() => {
    let cancelled = false;
    fetch(TOPO_URL)
      .then((r) => r.json())
      .then((j: Topology) => {
        if (!cancelled) setTopo(j);
      })
      .catch((e) => console.error('failed to load geo data', e));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      const w = Math.max(360, Math.floor(e.contentRect.width));
      const h = Math.max(420, Math.floor(w * 1.2));
      setSize({ w, h });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const viewFeatures = useMemo<ViewFeature[]>(() => {
    if (!topo) return [];
    return buildViewFeatures(topo, stats, view);
  }, [topo, stats, view]);

  // 본토만으로 projection 을 fit → mainland 확대. 제주/울릉은 별도 transform으로 inset 배치.
  const isOffshore = (code: string): 'jeju' | 'ulleung' | null => {
    if (view.level !== 'nation') return null;
    if (code.startsWith('50')) return 'jeju';
    if (code === '37320') return 'ulleung';
    return null;
  };

  const projection = useMemo(() => {
    if (viewFeatures.length === 0) return null;
    const mainland = viewFeatures.filter((v) => !isOffshore(v.feature.properties.code));
    const fcSource = mainland.length > 0 ? mainland : viewFeatures;
    const fc: FeatureCollection<Polygon | MultiPolygon> = {
      type: 'FeatureCollection',
      features: fcSource.map((v) => v.feature),
    };
    return geoMercator().fitExtent(
      [
        [12, 12],
        [size.w - 12, size.h - 12],
      ],
      fc as unknown as GeoPermissibleObjects,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewFeatures, size, view.level]);

  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  // 제주·울릉 inset 위치: 본토 viewBox 안의 빈 자리.
  // 제주는 본토 남서쪽 빈 공간 (좌하단), 울릉은 본토 오른쪽 빈 공간 (우상단).
  const offshoreTransform = (kind: 'jeju' | 'ulleung', vf: ViewFeature): string => {
    if (!path || !projection) return '';
    const c = path.centroid(vf.feature);
    if (!isFinite(c[0]) || !isFinite(c[1])) return '';
    const target = kind === 'jeju'
      ? { x: size.w * 0.18, y: size.h * 0.82, scale: 1.0 }
      : { x: size.w * 0.86, y: size.h * 0.28, scale: 3.0 };
    const dx = target.x - c[0] * target.scale;
    const dy = target.y - c[1] * target.scale;
    return `translate(${dx}, ${dy}) scale(${target.scale})`;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
      <div>
        <RegionBreadcrumb
          view={view}
          onNavigate={(v) => {
            setView(v);
            setLeaf(null);
          }}
        />
        <div ref={containerRef} className="mt-3 relative bg-slate-50 rounded-md overflow-hidden">
          {!topo && (
            <div className="aspect-[5/6] flex items-center justify-center text-sm text-slate-400">
              지도 데이터 불러오는 중…
            </div>
          )}
          {topo && path && (
            <svg
              viewBox={`0 0 ${size.w} ${size.h}`}
              className="w-full h-auto select-none"
              role="img"
              aria-label="지자체 계약현황 지도"
            >
              <defs>
                <pattern id="map-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="#f1f5f9" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke="#cbd5e1" strokeWidth="1" />
                </pattern>
              </defs>
              {viewFeatures.map((vf) => {
                const cov = coverageRate(vf.lgs);
                const noData = vf.lgs.every((l) => l.total === 0);
                const sum = sumParty(vf.lgs);
                const fill = noData ? 'url(#map-hatch)' : '';
                const cls = noData ? '' : partyColor(sum);
                const isHovered = hovered === vf.key;
                const d = path(vf.feature) ?? '';
                const offshore = isOffshore(vf.feature.properties.code);
                const groupTransform = offshore ? offshoreTransform(offshore, vf) : '';
                return (
                  <g key={vf.key} transform={groupTransform || undefined}>
                    <path
                      d={d}
                      fill={fill || undefined}
                      className={`${cls} transition cursor-pointer ${isHovered ? 'stroke-slate-900 stroke-2' : 'stroke-white'} stroke-[0.6]`}
                      onMouseEnter={() => setHovered(vf.key)}
                      onMouseLeave={() => setHovered((h) => (h === vf.key ? null : h))}
                      onClick={() => {
                        if (vf.drillTo) {
                          setView(vf.drillTo);
                          setLeaf(null);
                        } else if (vf.leaf) {
                          setLeaf(vf.leaf);
                        }
                      }}
                    >
                      <title>
                        {vf.label} · {fmtPct(cov.rate)} ({cov.covered}/{cov.total}) · {TINT_LABEL[partyTint(sum)]}
                      </title>
                    </path>
                  </g>
                );
              })}
              {viewFeatures.map((vf) => {
                if (!path) return null;
                const c = path.centroid(vf.feature);
                if (!isFinite(c[0]) || !isFinite(c[1])) return null;
                const bounds = path.bounds(vf.feature);
                const w = bounds[1][0] - bounds[0][0];
                const offshore = isOffshore(vf.feature.properties.code);
                if (!offshore && w < 28) return null;
                const noData = vf.lgs.length === 0 || vf.lgs.every((l) => l.total === 0);
                const sum = sumParty(vf.lgs);
                const completedTotal = sum.completed_monoplatform + sum.completed_imcity;
                const subLabel = noData ? '데이터 없음' : `${completedTotal}건`;
                let labelTransform: string;
                if (offshore) {
                  // offshore transform과 동일하게 centroid 위치를 SVG 위로 옮김.
                  const target = offshore === 'jeju'
                    ? { x: size.w * 0.18, y: size.h * 0.82 }
                    : { x: size.w * 0.86, y: size.h * 0.28 };
                  labelTransform = `translate(${target.x},${target.y})`;
                } else {
                  labelTransform = `translate(${c[0]},${c[1]})`;
                }
                return (
                  <g
                    key={`${vf.key}-label`}
                    transform={labelTransform}
                    pointerEvents="none"
                  >
                    <text
                      textAnchor="middle"
                      className="fill-slate-900 text-[10px] font-semibold"
                      style={{
                        paintOrder: 'stroke',
                        stroke: 'white',
                        strokeWidth: 3,
                      }}
                      y={-2}
                    >
                      {vf.label}
                    </text>
                    <text
                      textAnchor="middle"
                      className={`text-[9px] tabular-nums ${noData ? 'fill-slate-400' : 'fill-slate-700'}`}
                      style={{
                        paintOrder: 'stroke',
                        stroke: 'white',
                        strokeWidth: 3,
                      }}
                      y={9}
                    >
                      {subLabel}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
        <Legend />
      </div>

      {view.level === 'nation' && !leaf ? (
        <RegionNationPanel lgs={stats} />
      ) : (
        <RegionLeafPanel
          selection={leaf}
          onClose={() => setLeaf(null)}
          view={view}
        />
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
      <span className="font-medium text-slate-500">활성 메인 계약 주체</span>
      <span className="flex items-center gap-1.5">
        <svg width="14" height="14"><rect width="14" height="14" className="fill-orange-400" /></svg>
        모노플랫폼 직접
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="14" height="14"><rect width="14" height="14" className="fill-sky-300" /></svg>
        아이엠시티 경유
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="14" height="14"><rect width="14" height="14" className="fill-slate-200" /></svg>
        미체결
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="14" height="14"><rect width="14" height="14" fill="#f1f5f9" stroke="#cbd5e1" /></svg>
        데이터 없음
      </span>
    </div>
  );
}

// ---- view feature builders -------------------------------------------------

function buildViewFeatures(topo: Topology, stats: LgStat[], view: View): ViewFeature[] {
  switch (view.level) {
    case 'nation':
      return buildNation(topo, stats);
    case 'sido':
      return buildSido(topo, stats, view.sido);
    case 'si':
      return buildSi(topo, stats, view.sido, view.parent_si);
  }
}

function buildNation(topo: Topology, stats: LgStat[]): ViewFeature[] {
  const fc = feature(
    topo,
    topo.objects.sido as GeometryCollection<GeoProps>,
  ) as FeatureCollection<Polygon | MultiPolygon, GeoProps>;
  return fc.features.map((f) => {
    const sidoName = SIDO_BY_GEO_CODE[f.properties.code] ?? f.properties.name;
    const lgs = lgsBySidoCode(stats, f.properties.code);
    const drillTo: View = { level: 'sido', sido: sidoName };
    return {
      key: `sido:${f.properties.code}`,
      label: shortenSidoLabel(sidoName),
      feature: f,
      lgs,
      drillTo,
    };
  });
}

function buildSido(topo: Topology, stats: LgStat[], sidoName: string): ViewFeature[] {
  // Resolve sido code from name (DB may use post-rename name).
  const sidoCode = Object.entries(SIDO_BY_GEO_CODE).find(([, v]) => v === sidoName)?.[0];
  if (!sidoCode) return [];

  const sigunguTopoCol = topo.objects.sigungu as GeometryCollection<GeoProps>;
  const childrenOf = sigunguTopoCol.geometries.filter((g) =>
    (g.properties as GeoProps | undefined)?.code?.startsWith(sidoCode),
  );

  // 세종: single feature, render as leaf-only.
  if (sidoCode === '29') {
    const g = childrenOf[0];
    if (!g) return [];
    const props = g.properties as GeoProps;
    const f: GeoFeature = {
      type: 'Feature',
      geometry: (feature(topo, g) as GeoFeature).geometry,
      properties: props,
    };
    const lgs = lgsByGeoCode(stats, props.code);
    return [
      {
        key: `leaf:29`,
        label: '세종특별자치시',
        feature: f,
        lgs,
        leaf: leafFromLgs('세종특별자치시', lgs),
      },
    ];
  }

  // Group polygons by parent_si (for 시 with 일반구) or render as-is.
  const groups = new Map<string, typeof childrenOf>();
  const orderKeys: string[] = [];
  for (const g of childrenOf) {
    const props = g.properties as GeoProps;
    const parent = splitPolygonName(props.name).parent_si;
    const key = parent ?? props.code;
    if (!groups.has(key)) {
      groups.set(key, []);
      orderKeys.push(key);
    }
    groups.get(key)!.push(g);
  }

  const out: ViewFeature[] = [];
  for (const key of orderKeys) {
    const children = groups.get(key)!;
    const isParent = children.length > 1;
    if (isParent) {
      // merge 일반구 폴리곤 -> 통합 시 폴리곤
      const polyChildren = children as Array<
        TopoPolygon<GeoProps> | TopoMultiPolygon<GeoProps>
      >;
      const merged = merge(topo, polyChildren) as MultiPolygon;
      const codes = children.map((c) => (c.properties as GeoProps).code);
      const lgs = stats.filter(
        (s) => s.geo_code != null && codes.includes(s.geo_code),
      );
      const drillTo: View = { level: 'si', sido: sidoName, parent_si: key };
      out.push({
        key: `si:${sidoCode}:${key}`,
        label: key,
        feature: {
          type: 'Feature',
          geometry: merged,
          properties: { name: key, code: `${sidoCode}-${key}` },
        },
        lgs,
        drillTo,
      });
    } else {
      const g = children[0];
      const props = g.properties as GeoProps;
      const f: GeoFeature = {
        type: 'Feature',
        geometry: (feature(topo, g) as GeoFeature).geometry,
        properties: props,
      };
      const lgs = lgsByGeoCode(stats, props.code);
      out.push({
        key: `leaf:${props.code}`,
        label: props.name,
        feature: f,
        lgs,
        leaf: leafFromLgs(buildLeafTitle(sidoName, props.name, lgs), lgs),
      });
    }
  }
  return out;
}

function buildSi(
  topo: Topology,
  stats: LgStat[],
  sidoName: string,
  parentSi: string,
): ViewFeature[] {
  const sidoCode = Object.entries(SIDO_BY_GEO_CODE).find(([, v]) => v === sidoName)?.[0];
  if (!sidoCode) return [];
  const sigunguTopoCol = topo.objects.sigungu as GeometryCollection<GeoProps>;
  const children = sigunguTopoCol.geometries.filter((g) => {
    const props = g.properties as GeoProps | undefined;
    if (!props?.code?.startsWith(sidoCode)) return false;
    return splitPolygonName(props.name).parent_si === parentSi;
  });
  return children.map((g) => {
    const props = g.properties as GeoProps;
    const f: GeoFeature = {
      type: 'Feature',
      geometry: (feature(topo, g) as GeoFeature).geometry,
      properties: props,
    };
    const lgs = lgsByParentSi(stats, sidoName, parentSi).filter(
      (s) => s.geo_code === props.code,
    );
    const leafName = splitPolygonName(props.name).leaf;
    return {
      key: `leaf:${props.code}`,
      label: leafName,
      feature: f,
      lgs,
      leaf: leafFromLgs(`${sidoName} ${parentSi} ${leafName}`, lgs),
    };
  });
}

function leafFromLgs(title: string, lgs: LgStat[]): LeafSelection {
  const sum = rollup(lgs);
  return {
    title,
    lgs,
    counts: sum,
  };
}

function buildLeafTitle(sidoName: string, polygonName: string, lgs: LgStat[]): string {
  if (lgs.length === 1) return lgs[0].full_name;
  if (lgs.length > 1) {
    const tokens = lgs[0].full_name.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) return `${tokens[0]} ${tokens[1]}`;
  }
  return `${sidoName} ${polygonName}`;
}

// 라벨 길이가 너무 길면 시도 view에서 폴리곤 위에 안 들어가므로 축약.
function shortenSidoLabel(sido: string): string {
  return sido
    .replace('특별자치도', '')
    .replace('특별자치시', '')
    .replace('광역시', '')
    .replace('특별시', '');
}
