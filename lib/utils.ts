import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import type { Database } from '@/lib/types/database';

type ContractStatus = Database['public']['Enums']['contract_status'];
type UserRole = Database['public']['Enums']['user_role'];

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
}) {
  return c.extended_expiry_date ?? c.expiry_date;
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
