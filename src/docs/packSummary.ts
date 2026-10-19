/**
 * Two views of a pack: a one-line summary for the list on the left of the
 * screen, and a plain-text contents sheet that goes inside the ZIP download.
 */

import type { AppConfig } from '../config.ts';
import { assessPack, type TemplateRegistry } from './registry.ts';
import type { Pack, Store } from '../db.ts';
import { labelFor } from './fields.ts';
import { RULES_REVIEWED_ON } from '../knowledge/rules.ts';

export type PackSummaryView = {
  id: string;
  reference: string;
  tenantName: string;
  propertyAddress: string;
  status: Pack['status'];
  documentCount: number;
  errorCount: number;
  warningCount: number;
  /** Every essential detail is present. */
  ready: boolean;
  updatedAt: string;
};

export function packSummaryView(pack: Pack, store: Store): PackSummaryView {
  const documents = store.listDocuments(pack.id);
  const readiness = assessPack(pack.fields);
  return {
    id: pack.id,
    reference: pack.reference,
    tenantName: pack.tenantName,
    propertyAddress: pack.propertyAddress,
    status: pack.status,
    documentCount: documents.length,
    errorCount: readiness.compliance.counts.error,
    warningCount: readiness.compliance.counts.warning,
    ready: readiness.ready,
    updatedAt: pack.updatedAt,
  };
}

function formatDate(value: string | undefined): string {
  if (value === undefined || value === '') return '—';
  const [year, month, day] = value.split('-');
  if (year === undefined || month === undefined || day === undefined) return value;
  return `${Number(day)} ${new Date(`${value}T00:00:00`).toLocaleString('en-GB', { month: 'long' })} ${year}`;
}

/** The human-readable sheet included as the first file in the ZIP. */
export function buildPackSummaryText(
  pack: Pack,
  store: Store,
  registry: TemplateRegistry,
  config: AppConfig,
): string {
  const documents = store.listDocuments(pack.id);
  const readiness = assessPack(pack.fields);
  const lines: string[] = [];

  lines.push('TENANCYDESK — DOCUMENT PACK');
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`Reference:   ${pack.reference}`);
  lines.push(`Tenant(s):   ${pack.tenantName !== '' ? pack.tenantName : '—'}`);
  lines.push(`Property:    ${pack.propertyAddress !== '' ? pack.propertyAddress : '—'}`);
  lines.push(`Prepared:    ${new Date().toLocaleString('en-GB')}`);
  lines.push(`Agency:      ${config.agency.name !== '' ? config.agency.name : '—'}`);
  lines.push('');

  lines.push('WHAT IS IN THIS PACK');
  lines.push('-'.repeat(60));
  if (documents.length === 0) {
    lines.push('(no documents)');
  } else {
    for (const document of documents) {
      lines.push(`• ${document.title}`);
    }
  }
  lines.push('');

  const deadlines = readiness.compliance.deadlines;
  if (deadlines.length > 0) {
    lines.push('KEY DATES');
    lines.push('-'.repeat(60));
    for (const deadline of deadlines) {
      lines.push(`• ${formatDate(deadline.date)} — ${deadline.label}`);
    }
    lines.push('');
  }

  lines.push('COMPLIANCE CHECKS');
  lines.push('-'.repeat(60));
  if (readiness.compliance.findings.length === 0) {
    lines.push('No issues found.');
  } else {
    for (const finding of readiness.compliance.findings) {
      lines.push(`[${finding.severity.toUpperCase()}] ${finding.title}`);
      lines.push(`    ${finding.detail}`);
    }
  }
  lines.push('');

  const missing = registry.list(pack.fields).flatMap((doc) => doc.missing);
  const uniqueMissing = [...new Set(missing)];
  if (uniqueMissing.length > 0) {
    lines.push('FIELDS LEFT BLANK');
    lines.push('-'.repeat(60));
    for (const key of uniqueMissing) lines.push(`• ${labelFor(key)}`);
    lines.push('');
  }

  if (pack.notes.length > 0) {
    lines.push('NOTES');
    lines.push('-'.repeat(60));
    for (const note of pack.notes) lines.push(`• ${note.text}`);
    lines.push('');
  }

  if (pack.coverMessage !== null) {
    lines.push('MESSAGE TO THE TENANT');
    lines.push('-'.repeat(60));
    if (pack.coverMessage.email !== undefined) {
      lines.push('[EMAIL]');
      lines.push(pack.coverMessage.email);
      lines.push('');
    }
    if (pack.coverMessage.whatsapp !== undefined) {
      lines.push('[WHATSAPP]');
      lines.push(pack.coverMessage.whatsapp);
      lines.push('');
    }
  }

  lines.push('='.repeat(60));
  lines.push('Produced by TenancyDesk from templates. This is not legal advice.');
  lines.push('Check every detail, and the current law, before signing.');
  lines.push(`Rule set last reviewed: ${RULES_REVIEWED_ON}`);

  return lines.join('\n');
}
