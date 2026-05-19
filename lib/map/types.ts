import type { Database } from '@/lib/types/database';

export type LgClass = Database['public']['Enums']['lg_class'];

export type LgStat = {
  lg_id: string;
  sido: string;
  sigungu: string;
  full_name: string;
  classification: LgClass;
  geo_code: string | null;
  total: number;
  completed: number;
  in_progress: number;
  updating: number;
  terminated: number;
  completed_monoplatform: number;
  completed_imcity: number;
  /** 살아있는(status != terminated) 유지보수(mou) 부속 보유 여부. */
  has_maintenance: boolean;
};

export type PartyTint = 'monoplatform' | 'imcity' | 'none';

export type SidoSummary = {
  sido: string;
  lg_count: number;
  completed: number;
  completed_monoplatform: number;
  completed_imcity: number;
};

export type View =
  | { level: 'nation' }
  | { level: 'sido'; sido: string }
  | { level: 'si'; sido: string; parent_si: string };

export type Coverage = {
  rate: number | null;
  covered: number;
  total: number;
};
