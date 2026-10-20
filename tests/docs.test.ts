import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { depositCap, runComplianceChecks, weeklyRent } from '../src/docs/compliance.ts';
import {
  mergeFields,
  missingCoreFields,
  normaliseFields,
  hasValue,
  paymentDateFor,
} from '../src/docs/fields.ts';
import { completeFields } from './helpers.ts';

const TODAY = new Date(2026, 9, 19); // 19 October 2026
const ids = (report: ReturnType<typeof runComplianceChecks>) => report.findings.map((finding) => finding.id);

describe('completeness', () => {
  it('accepts a complete pack', () => {
    assert.deepEqual(missingCoreFields(completeFields()), []);
  });

  it('reports each missing essential field', () => {
    const missing = missingCoreFields({});
    assert.ok(missing.includes('landlord.full_name'));
    assert.ok(missing.includes('tenants'));
  });

  it('treats a tenant with no name as missing', () => {
    const fields = completeFields();
    fields['tenants'] = [{ email: 'nobody@example.test' }];
    assert.deepEqual(missingCoreFields(fields), ['tenants']);
  });
});

describe('rent and deposit arithmetic', () => {
  it('converts monthly rent to a weekly figure', () => {
    const weekly = weeklyRent({ 'tenancy.rent_amount': 1250, 'tenancy.rent_frequency': 'Monthly' });
    assert.ok(weekly !== null && Math.abs(weekly - 288.4615) < 0.01);
  });

  it('treats weekly rent as-is', () => {
    assert.equal(weeklyRent({ 'tenancy.rent_amount': 300, 'tenancy.rent_frequency': 'Weekly' }), 300);
  });

  it('caps the deposit at five weeks’ rent below £50,000 a year', () => {
    const cap = depositCap({ 'tenancy.rent_amount': 1250, 'tenancy.rent_frequency': 'Monthly' });
    assert.ok(cap !== null && Math.abs(cap - 1442.3077) < 0.01);
  });

  it('allows six weeks where annual rent is £50,000 or more', () => {
    const weekly = 1000; // £52,000 a year
    const cap = depositCap({ 'tenancy.rent_amount': weekly, 'tenancy.rent_frequency': 'Weekly' });
    assert.equal(cap, 6000);
  });
});

describe('compliance checks', () => {
  it('passes a complete pack with no errors', () => {
    const report = runComplianceChecks(completeFields(), { today: TODAY });
    assert.equal(report.counts.error, 0, JSON.stringify(report.findings.filter((f) => f.severity === 'error')));
    assert.equal(report.ok, true);
  });

  it('flags a deposit above the cap', () => {
    const fields = completeFields();
    fields['tenancy.deposit_amount'] = 2500;
    const report = runComplianceChecks(fields, { today: TODAY });
    assert.ok(ids(report).includes('deposit-over-cap'));
    assert.equal(report.ok, false);
  });

  it('flags a holding deposit above one week’s rent', () => {
    const fields = completeFields();
    fields['tenancy.holding_deposit_amount'] = 900;
    assert.ok(ids(runComplianceChecks(fields, { today: TODAY })).includes('holding-over-cap'));
  });

  it('flags more than one month’s rent taken in advance', () => {
    const fields = completeFields();
    fields['tenancy.rent_in_advance'] = 2500;
    assert.ok(ids(runComplianceChecks(fields, { today: TODAY })).includes('advance-over-cap'));
  });

  it('flags an unprotected deposit as a warning while there is still time', () => {
    const fields = completeFields();
    fields['tenancy.deposit_scheme'] = 'Not yet protected';
    const report = runComplianceChecks(fields, { today: TODAY });
    const finding = report.findings.find((item) => item.id === 'deposit-not-protected');
    assert.equal(finding?.severity, 'warning');
  });

  it('escalates an unprotected deposit once the 30 days have passed', () => {
    const fields = completeFields();
    fields['tenancy.deposit_scheme'] = 'Not yet protected';
    fields['tenancy.deposit_received_date'] = '2026-08-01';
    const report = runComplianceChecks(fields, { today: TODAY });
    const finding = report.findings.find((item) => item.id === 'deposit-not-protected');
    assert.equal(finding?.severity, 'error');
  });

  it('flags a gas safety certificate older than a year', () => {
    const fields = completeFields();
    fields['safety.gas_safety_date'] = '2025-06-01';
    assert.ok(ids(runComplianceChecks(fields, { today: TODAY })).includes('gas-safety-expired'));
  });

  it('flags a gas safety check dated after move-in', () => {
    const fields = completeFields();
    fields['safety.gas_safety_date'] = '2026-12-01';
    assert.ok(ids(runComplianceChecks(fields, { today: TODAY })).includes('gas-safety-after-start'));
  });

  it('flags an EICR older than five years', () => {
    const fields = completeFields();
    fields['safety.eicr_date'] = '2020-01-01';
    assert.ok(ids(runComplianceChecks(fields, { today: TODAY })).includes('eicr-expired'));
  });

  it('refuses an F or G rated property', () => {
    const fields = completeFields();
    fields['property.epc_rating'] = 'F';
    const report = runComplianceChecks(fields, { today: TODAY });
    assert.ok(ids(report).includes('epc-below-e'));
    assert.equal(report.ok, false);
  });

  it('warns when the tenant notice period is not two months', () => {
    const fields = completeFields();
    fields['tenancy.notice_period_tenant'] = '1 month';
    assert.ok(ids(runComplianceChecks(fields, { today: TODAY })).includes('notice-period'));
  });

  it('produces the two statutory deadlines', () => {
    const report = runComplianceChecks(completeFields(), { today: TODAY });
    const deposit = report.deadlines.find((deadline) => deadline.id === 'deposit-protection');
    const statement = report.deadlines.find((deadline) => deadline.id === 'written-statement');
    assert.equal(deposit?.date, '2026-11-19'); // 30 days after 20 October
    assert.equal(statement?.date, '2026-11-29'); // 28 days after 1 November
  });

  it('sorts deadlines by date', () => {
    const report = runComplianceChecks(completeFields(), { today: TODAY });
    const dates = report.deadlines.map((deadline) => deadline.date);
    assert.deepEqual(dates, [...dates].sort());
  });

  it('warns when the client money protection field does not hold a scheme name', () => {
    const fields = completeFields();
    fields['agent.client_money_scheme'] = '£233';
    const report = runComplianceChecks(fields, { today: TODAY });
    const finding = report.findings.find((item) => item.id === 'agency-cmp-suspect');
    assert.ok(finding, 'a stray amount must not pass as a scheme name');
    assert.equal(finding?.severity, 'warning');
    assert.match(finding?.detail ?? '', /£233/);
  });

  it('accepts a real scheme name', () => {
    const fields = completeFields();
    fields['agent.client_money_scheme'] = 'Propertymark Client Money Protection';
    fields['agent.redress_scheme'] = 'The Property Ombudsman';
    const report = runComplianceChecks(fields, { today: TODAY });
    assert.equal(report.findings.some((item) => item.id.endsWith('-suspect')), false);
  });

  it('warns when the redress scheme field holds a number', () => {
    const fields = completeFields();
    fields['agent.redress_scheme'] = '01234 567890';
    assert.ok(ids(runComplianceChecks(fields, { today: TODAY })).includes('agency-redress-suspect'));
  });

  it('reports missing essentials as errors so generation is blocked', () => {
    const report = runComplianceChecks({}, { today: TODAY });
    assert.ok(report.counts.error > 0);
    assert.equal(report.ok, false);
  });
});

describe('field normalisation', () => {
  it('coerces money and dates', () => {
    const normalised = normaliseFields({
      'tenancy.rent_amount': '£1,250',
      'tenancy.start_date': '01/11/2026',
      'property.bedrooms': '2',
    });
    assert.equal(normalised['tenancy.rent_amount'], 1250);
    assert.equal(normalised['tenancy.start_date'], '2026-11-01');
    assert.equal(normalised['property.bedrooms'], 2);
  });

  it('drops keys that are not in the catalogue', () => {
    const normalised = normaliseFields({ 'tenancy.rent_amount': 900, made_up: 'x' });
    assert.deepEqual(Object.keys(normalised), ['tenancy.rent_amount']);
  });

  it('drops empty values', () => {
    assert.deepEqual(normaliseFields({ 'landlord.full_name': '   ' }), {});
  });

  it('cleans the tenant list', () => {
    const normalised = normaliseFields({
      tenants: [{ full_name: ' Alex ', email: '' }, {}],
    });
    assert.deepEqual(normalised['tenants'], [{ full_name: 'Alex' }]);
  });
});

describe('derived values', () => {
  it('sets the first payment date to the day before the tenancy starts', () => {
    const { merged } = mergeFields({}, { 'tenancy.start_date': '2026-11-01' });
    assert.equal(merged['tenancy.payment_date'], '2026-10-31');
  });

  it('works across a month boundary and a leap year', () => {
    assert.equal(paymentDateFor('2026-03-01'), '2026-02-28');
    assert.equal(paymentDateFor('2028-03-01'), '2028-02-29');
    assert.equal(paymentDateFor('2027-01-01'), '2026-12-31');
  });

  it('is calendar-safe across the October clock change', () => {
    // Adding 24 hours of milliseconds here would land on 24 October again.
    assert.equal(paymentDateFor('2026-10-26'), '2026-10-25');
  });

  it('re-derives when the start date changes', () => {
    const first = mergeFields({}, { 'tenancy.start_date': '2026-11-01' }).merged;
    const second = mergeFields(first, { 'tenancy.start_date': '2026-12-01' }).merged;
    assert.equal(second['tenancy.payment_date'], '2026-11-30');
  });

  it('lets an explicit payment date win', () => {
    const { merged } = mergeFields(
      {},
      { 'tenancy.start_date': '2026-11-01', 'tenancy.payment_date': '2026-11-01' },
    );
    assert.equal(merged['tenancy.payment_date'], '2026-11-01');
  });

  it('does nothing without a start date', () => {
    const { merged } = mergeFields({}, { 'tenancy.rent_amount': 980 });
    assert.equal('tenancy.payment_date' in merged, false);
  });
});

describe('merging', () => {
  it('adds new values', () => {
    const { merged, written } = mergeFields({ 'landlord.full_name': 'A' }, { 'landlord.phone': '0123' });
    assert.equal(merged['landlord.phone'], '0123');
    assert.deepEqual(written, ['landlord.phone']);
    assert.equal(merged['landlord.full_name'], 'A');
  });

  it('never overwrites a good value with an empty one', () => {
    const { merged } = mergeFields({ 'landlord.full_name': 'Priya' }, { 'landlord.full_name': '' });
    assert.equal(merged['landlord.full_name'], 'Priya');
  });

  it('reports unknown keys rather than storing them', () => {
    const { merged, unknown } = mergeFields({}, { nonsense: 'yes' });
    assert.deepEqual(unknown, ['nonsense']);
    assert.equal('nonsense' in merged, false);
  });

  it('replaces the tenant list wholesale', () => {
    const previous = { tenants: [{ full_name: 'Old Tenant' }] };
    const { merged } = mergeFields(previous, { tenants: [{ full_name: 'New Tenant' }] });
    assert.deepEqual(merged['tenants'], [{ full_name: 'New Tenant' }]);
  });

  it('keeps an existing tenant list when none is supplied', () => {
    const previous = { tenants: [{ full_name: 'Old Tenant' }] };
    const { merged } = mergeFields(previous, { 'landlord.full_name': 'X' });
    assert.deepEqual(merged['tenants'], [{ full_name: 'Old Tenant' }]);
  });

  it('knows what counts as filled', () => {
    assert.equal(hasValue('  '), false);
    assert.equal(hasValue(0), true);
    assert.equal(hasValue([]), false);
  });
});
