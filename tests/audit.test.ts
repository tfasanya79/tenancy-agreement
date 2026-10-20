import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { auditDocumentText } from '../src/docs/templateAudit.ts';
import { TemplateRegistry } from '../src/docs/registry.ts';

const LEGACY = `Assured Shorthold Tenancy Agreement

This Agreement is an Assured Shorthold Tenancy (as defined in Section 19A of the Housing Act 1988).
The repossession arrangements in Section 21 of the Housing Act 1988 apply to this Agreement.
The tenancy is for a fixed term of six months from the Start Date.
The Landlord may increase the Rent by a reasonable percentage on each anniversary.
The Deposit will be held by the Landlord. The Tenant may keep a pet only with consent.`;

const MODERN = `Assured Periodic Tenancy Agreement

This is an assured periodic tenancy. It has no fixed end date.
Since 1 May 2026 section 21 of the Housing Act 1988 is abolished, and no section 21 notice may be served.
The Landlord may increase the rent no more than once in any 12-month period, by serving a section 13
notice on the prescribed form at least two months before the increase takes effect.
The Deposit will be protected in an approved scheme within 30 days.
The Tenant may request permission to keep a pet, which the Landlord will consider within 28 days.`;

const ids = (text: string) => auditDocumentText(text).findings.map((finding) => finding.id);

describe('auditing a legacy document', () => {
  it('finds every problem in a pre-May-2026 agreement', () => {
    const report = auditDocumentText(LEGACY);
    assert.equal(report.ok, false);
    for (const id of ['assured-shorthold', 'section-21', 'section-19a', 'fixed-term', 'rent-increase-vague']) {
      assert.ok(ids(LEGACY).includes(id), `expected to flag ${id}`);
    }
    assert.ok(report.counts.error >= 2);
  });

  it('quotes the offending text so a human can check it', () => {
    const finding = auditDocumentText(LEGACY).findings.find((item) => item.id === 'section-21');
    assert.ok(finding?.excerpt?.includes('Section 21'));
  });

  it('links each finding to a rule', () => {
    const finding = auditDocumentText(LEGACY).findings.find((item) => item.id === 'assured-shorthold');
    assert.equal(finding?.ruleId, 'tenancy-type');
  });
});

describe('auditing a current document', () => {
  it('does not flag a document that mentions section 21 only to say it is abolished', () => {
    const report = auditDocumentText(MODERN);
    assert.equal(report.counts.error, 0, JSON.stringify(report.findings.map((f) => f.id)));
    assert.equal(report.ok, true);
  });

  it('does not flag "creates no fixed term"', () => {
    assert.equal(ids('This agreement creates no fixed term and runs month to month.').includes('fixed-term'), false);
  });

  it('does not flag "no more than once in any 12-month period"', () => {
    const text = 'The rent may be increased no more than once in any 12-month period by section 13 notice.';
    assert.equal(ids(text).includes('rent-increase-vague'), false);
  });

  it('still flags a document that uses both old and new language', () => {
    const hybrid = `${MODERN}\n\nFor the avoidance of doubt this Agreement is an Assured Shorthold Tenancy.`;
    assert.ok(ids(hybrid).includes('assured-shorthold'));
  });
});

describe('absence checks', () => {
  it('warns when an agreement has no pets provision', () => {
    const text = 'Assured Periodic Tenancy Agreement. The Landlord lets the Property to the Tenant. The Deposit is held.';
    assert.ok(ids(text).includes('no-pets-clause'));
  });

  it('does not apply agreement checks to a deposit form or an inventory', () => {
    const depositForm = 'Tenancy Deposit Prescribed Information. The deposit is held by the scheme. This relates to the tenancy agreement.';
    assert.equal(ids(depositForm).includes('no-pets-clause'), false);
    const inventory = 'Inventory and Check-In Report. Condition of the tenancy agreement property. The deposit is unaffected.';
    assert.equal(ids(inventory).includes('no-pets-clause'), false);
  });

  it('notes a missing 30-day deposit deadline without treating it as an error', () => {
    const text = 'Assured Periodic Tenancy Agreement. The Landlord lets the Property. A Deposit is payable. A pet may be requested.';
    const report = auditDocumentText(text);
    const finding = report.findings.find((item) => item.id === 'deposit-deadline');
    assert.equal(finding?.severity, 'info');
  });
});

describe('edge cases', () => {
  it('explains an empty document, which is usually a scan', () => {
    const report = auditDocumentText('   \n\n  ');
    assert.equal(report.ok, false);
    assert.equal(report.wordCount, 0);
    assert.equal(report.findings[0]?.id, 'no-text');
    assert.match(report.findings[0]?.detail ?? '', /scan/);
  });

  it('counts words for the report', () => {
    assert.equal(auditDocumentText('one two three four').wordCount, 4);
  });

  it('keeps the counts consistent with the findings', () => {
    const report = auditDocumentText(LEGACY);
    assert.equal(report.counts.error, report.findings.filter((f) => f.severity === 'error').length);
    assert.equal(report.ok, report.counts.error === 0);
  });
});

describe('internal consistency', () => {
  it('catches a weekday that does not match its date', () => {
    // 5 September 2026 really is a Saturday.
    const report = auditDocumentText('The first payment is due before Wednesday 5th September 2026.');
    const finding = report.findings.find((item) => item.id === 'weekday-mismatch');
    assert.ok(finding, 'a wrong weekday must be reported');
    assert.equal(finding?.severity, 'error');
    assert.match(finding?.detail ?? '', /Saturday/);
  });

  it('accepts a weekday that does match', () => {
    // 30 October 2026 really is a Friday.
    assert.equal(ids('Completion on Friday 30th October 2026.').includes('weekday-mismatch'), false);
  });

  it('catches two different rent due days in one document', () => {
    const text =
      'You must pay the rent in advance on the 1st of each month. ' +
      'Subsequent rent payments must be paid in advance on the 4th of each month.';
    const finding = auditDocumentText(text).findings.find((item) => item.id === 'rent-due-inconsistent');
    assert.ok(finding, 'contradictory due days must be reported');
    assert.match(finding?.detail ?? '', /1st/);
    assert.match(finding?.detail ?? '', /4th/);
  });

  it('ignores a worked example about a different day', () => {
    const text =
      'Rent is due on the 4th of each month. ' +
      'If the Tenancy is monthly and Rent is due on the 10th of each month, the Rental Period runs from the 10th.';
    assert.equal(ids(text).includes('rent-due-inconsistent'), false);
  });

  it('flags a fixed late-payment fee as a prohibited payment', () => {
    const report = auditDocumentText(
      'For any late rental payment there is an additional £15 admin fee that will be added.',
    );
    const finding = report.findings.find((item) => item.id === 'prohibited-fee');
    assert.ok(finding);
    assert.equal(finding?.severity, 'error');
    assert.equal(finding?.ruleId, 'prohibited-payments');
  });

  it('flags a duplicated ordinal as a typo', () => {
    const report = auditDocumentText('Rent is payable in advance on the 1stth of each month.');
    const finding = report.findings.find((item) => item.id === 'ordinal-typo');
    assert.ok(finding);
    assert.match(finding?.detail ?? '', /1stth/);
    assert.match(finding?.detail ?? '', /meant to be/);
  });
});

describe('our own templates', () => {
  it('all pass the audit they will apply to uploads', async () => {
    const registry = await TemplateRegistry.load('./templates');
    for (const summary of registry.list()) {
      const report = auditDocumentText(registry.get(summary.id).body);
      assert.equal(
        report.counts.error,
        0,
        `${summary.id} has audit errors: ${report.findings.filter((f) => f.severity === 'error').map((f) => f.id).join(', ')}`,
      );
      assert.equal(
        report.counts.warning,
        0,
        `${summary.id} has audit warnings: ${report.findings.filter((f) => f.severity === 'warning').map((f) => f.id).join(', ')}`,
      );
    }
  });
});
