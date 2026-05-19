import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import type { Database } from '@/lib/types/database';

type ContractStatus = Database['public']['Enums']['contract_status'];
type UserRole = Database['public']['Enums']['user_role'];
type ContractingParty = Database['public']['Enums']['contracting_party'];
type ContractType = Database['public']['Enums']['contract_type'];

export const STATUS_LABEL: Record<ContractStatus, string> = {
  in_progress: '체결중',
  completed: '계약완료',
  updating: '갱신중',
  terminated: '종료',
};

export const STATUS_BADGE: Record<ContractStatus, string> = {
  in_progress: 'bg-orange-100 text-orange-700 ring-orange-600/20',
  completed: 'bg-green-100 text-green-700 ring-green-600/20',
  updating: 'bg-blue-100 text-blue-700 ring-blue-600/20',
  terminated: 'bg-gray-100 text-gray-600 ring-gray-500/20',
};

export const ROLE_LABEL: Record<UserRole, string> = {
  master: 'Master',
  accounting: 'Accounting',
  viewer: 'Viewer',
};

export const PARTY_LABEL: Record<ContractingParty, string> = {
  monoplatform: '모노플랫폼 직접',
  imcity: '아이엠시티 경유',
};

export const PARTY_BADGE: Record<ContractingParty, string> = {
  monoplatform: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  imcity: 'bg-purple-50 text-purple-700 ring-purple-600/20',
};

export const TYPE_LABEL: Record<ContractType, string> = {
  parking_enforcement: '주차단속 위수탁',
  personal_info_outsourcing: '개인정보 위수탁',
  mou: '유지보수',
  other: '기타',
};

export const TYPE_BADGE: Record<ContractType, string> = {
  parking_enforcement: 'bg-slate-100 text-slate-800 ring-slate-500/20',
  personal_info_outsourcing: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  mou: 'bg-teal-50 text-teal-800 ring-teal-600/20',
  other: 'bg-gray-100 text-gray-700 ring-gray-500/20',
};

export function fmtDate(d: string | null | undefined) {
  if (!d) return '-';
  return d.slice(0, 10);
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return '-';
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function effectiveExpiry(c: {
  expiry_date: string | null;
  extended_expiry_date: string | null;
  auto_renewal?: boolean | null;
  auto_renewal_period_months?: number | null;
  auto_renewal_end_date?: string | null;
}): string | null {
  if (c.extended_expiry_date) return c.extended_expiry_date;
  if (c.auto_renewal && c.auto_renewal_period_months && c.expiry_date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [y, m, d] = c.expiry_date.split('-').map(Number);
    const cur = new Date(y, m - 1, d);
    let end: Date | null = null;
    if (c.auto_renewal_end_date) {
      const [ey, em, ed] = c.auto_renewal_end_date.split('-').map(Number);
      end = new Date(ey, em - 1, ed);
    }
    let i = 0;
    while (cur < today && i < 240) {
      cur.setMonth(cur.getMonth() + c.auto_renewal_period_months);
      if (end && cur > end) return c.auto_renewal_end_date ?? null;
      i++;
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`;
  }
  return c.expiry_date;
}

/**
 * 날짜 문자열(YYYY-MM-DD)에 개월수를 더한 새 YYYY-MM-DD를 반환.
 * 자동연장 1주기를 미리 만료일로 굳히는 ExtendModal 의 "자동연장 적용" 버튼이 사용.
 */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setMonth(dt.getMonth() + months);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function formatAutoRenewalPeriod(
  months: number | null | undefined,
): string {
  if (!months || months < 1) return '';
  if (months % 12 === 0) return `${months / 12}년`;
  return `${months}개월`;
}

export function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

export function canWrite(role: UserRole | null | undefined) {
  return role === 'master' || role === 'accounting';
}
