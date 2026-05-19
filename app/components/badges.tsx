import {
  STATUS_LABEL,
  STATUS_BADGE,
  TYPE_LABEL,
  TYPE_BADGE,
  PARTY_LABEL,
  PARTY_BADGE,
} from '@/lib/utils';
import type { Database } from '@/lib/types/database';

type Status = Database['public']['Enums']['contract_status'];
type Ctype = Database['public']['Enums']['contract_type'];
type Party = Database['public']['Enums']['contracting_party'];

type Size = 'sm' | 'md';

const SIZE_CLASS: Record<Size, string> = {
  sm: 'text-[11px] px-2 py-0.5',
  md: 'text-xs px-2.5 py-0.5',
};

const BASE = 'inline-flex items-center font-medium rounded ring-1 ring-inset';

export function StatusBadge({ status, size = 'sm' }: { status: Status; size?: Size }) {
  return (
    <span className={`${BASE} ${SIZE_CLASS[size]} ${STATUS_BADGE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function TypeBadge({
  ctype,
  isSupplement,
  size = 'sm',
}: {
  ctype: Ctype;
  /** true 면 "·부속", false 면 "·메인", undefined 면 suffix 없음 */
  isSupplement?: boolean;
  size?: Size;
}) {
  const suffix =
    isSupplement === undefined ? '' : isSupplement ? '·부속' : '·메인';
  return (
    <span className={`${BASE} ${SIZE_CLASS[size]} ${TYPE_BADGE[ctype]}`}>
      {TYPE_LABEL[ctype]}
      {suffix}
    </span>
  );
}

export function PartyBadge({ party, size = 'sm' }: { party: Party; size?: Size }) {
  return (
    <span className={`${BASE} ${SIZE_CLASS[size]} ${PARTY_BADGE[party]}`}>
      {PARTY_LABEL[party]}
    </span>
  );
}
