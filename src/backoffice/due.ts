/**
 * What needs doing, across every tenancy.
 *
 * The app already works out each pack's statutory deadlines. This gathers them into
 * one list, sorted by date, so the agency can answer "what is due this week?"
 * without opening a single pack — which is the question an agent actually asks.
 */

import type { Store } from '../db.ts';
import { runComplianceChecks } from '../docs/compliance.ts';
import type { BackOffice } from './entities.ts';
import { contextFor } from './context.ts';

export type DueKind = 'deposit-protection' | 'written-statement' | 'deposit-return' | 'gas-safety' | 'eicr' | 'start';

export type DueItem = {
  packId: string;
  reference: string;
  tenantName: string;
  propertyAddress: string;
  kind: DueKind;
  label: string;
  /** ISO date. */
  date: string;
  /** Negative when it has already passed. */
  daysUntil: number;
  detail: string;
};

export type DueReport = {
  items: DueItem[];
  /** How many are already past their date. */
  overdue: number;
  /** How many fall in the next 30 days, today included. */
  soon: number;
};

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysBetween(fromIso: string, to: Date): number {
  const [year, month, day] = fromIso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return 0;
  const target = Date.UTC(year, month - 1, day);
  const today = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((target - today) / 86_400_000);
}

/**
 * Every deadline across every tenancy, oldest first.
 * Tenancies that have ended are left out — their dates no longer need chasing.
 */
export function aggregateDue(store: Store, backOffice: BackOffice, today = new Date()): DueReport {
  const items: DueItem[] = [];

  for (const pack of store.listPacks()) {
    if (pack.lifecycle === 'ended') continue;

    const context = contextFor(pack, backOffice);
    const fields = { ...context.resolved.values };
    const report = runComplianceChecks(fields, { today });

    for (const deadline of report.deadlines) {
      const kind: DueKind =
        deadline.id === 'deposit-protection'
          ? 'deposit-protection'
          : deadline.id === 'written-statement'
            ? 'written-statement'
            : deadline.id === 'gas-safety-renewal'
              ? 'gas-safety'
              : 'eicr';

      items.push({
        packId: pack.id,
        reference: pack.reference,
        tenantName: pack.tenantName,
        propertyAddress: pack.propertyAddress,
        kind,
        label: deadline.label,
        date: deadline.date,
        daysUntil: daysBetween(deadline.date, today),
        detail: deadline.detail,
      });
    }

    // A tenancy that has not started yet is itself something to be ready for.
    const start = fields['tenancy.start_date'];
    if (pack.lifecycle === 'upcoming' && typeof start === 'string' && start !== '') {
      items.push({
        packId: pack.id,
        reference: pack.reference,
        tenantName: pack.tenantName,
        propertyAddress: pack.propertyAddress,
        kind: 'start',
        label: 'Tenancy starts — paperwork and keys ready',
        date: start,
        daysUntil: daysBetween(start, today),
        detail: `The tenancy begins on ${start}.`,
      });
    }
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));

  return {
    items,
    overdue: items.filter((item) => item.daysUntil < 0).length,
    soon: items.filter((item) => item.daysUntil >= 0 && item.daysUntil <= 30).length,
  };
}

/** How many deadlines for one tenancy fall in the next 30 days, for the sidebar. */
export function dueSoonFor(fields: Record<string, unknown>, today = new Date()): number {
  const report = runComplianceChecks(fields, { today });
  return report.deadlines.filter((deadline) => {
    const days = daysBetween(deadline.date, today);
    return days >= 0 && days <= 30;
  }).length;
}

export { toIso, daysBetween };
