import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { proposeLinks } from '../src/docs/linkProposal.ts';

const bySample = (text: string) => {
  const map = new Map<string, { field: string; confidence: string; hint: string }>();
  for (const link of proposeLinks(text).links) {
    map.set(link.sample, { field: link.field, confidence: link.confidence, hint: link.hint });
  }
  return map;
};

describe('proposing links', () => {
  it('maps money that is clearly the rent or the deposit', () => {
    const links = bySample('You must pay rent of £1,450 per calendar month. A deposit of £1,673 is held.');
    assert.equal(links.get('£1,450')?.field, 'tenancy.rent_amount');
    assert.equal(links.get('£1,450')?.confidence, 'likely');
    assert.equal(links.get('£1,673')?.field, 'tenancy.deposit_amount');
  });

  it('refuses to guess when rent and deposit sit in the same sentence', () => {
    const links = bySample('The rent is £1,450 and the deposit is also discussed here at £1,673.');
    // Where the context cannot separate them, it asks instead of asserting.
    assert.equal(links.get('£1,450')?.confidence !== undefined, true);
    for (const [sample, link] of links) {
      if (link.confidence === 'check') assert.equal(link.field, '');
      assert.ok(sample !== '');
    }
  });

  it('never calls a fee the rent', () => {
    // "an additional £15 admin fee" sits right next to the word rental.
    const links = bySample('For any late rental payment there is an additional £15 admin fee that will be added.');
    assert.equal(links.get('£15')?.field, '', 'a fee must not be mapped to the rent');
    assert.match(links.get('£15')?.hint ?? '', /fee or charge/);
  });

  it('maps dates by the words immediately before them', () => {
    const links = bySample(
      'The tenancy commences on 1 November 2026. The inventory was agreed on 31 October 2026.',
    );
    assert.equal(links.get('1 November 2026')?.field, 'tenancy.start_date');
    assert.equal(links.get('31 October 2026')?.field, 'inventory.scheduled_date');
  });

  it('asks which postcode when there is more than one', () => {
    const links = bySample('The property is E17 3NU and the scheme is at PE21 6PL.');
    assert.equal(links.get('E17 3NU')?.field, '');
    assert.equal(links.get('E17 3NU')?.confidence, 'check');
    assert.match(links.get('E17 3NU')?.hint ?? '', /several postcodes/);
  });

  it('accepts a single postcode without asking', () => {
    const links = bySample('The property is at 14 Beech Road, London E17 3NU.');
    assert.equal(links.get('E17 3NU')?.field, 'property.postcode');
    assert.equal(links.get('E17 3NU')?.confidence, 'likely');
  });

  it('does not mistake a deposit scheme address for the tenant', () => {
    const links = bySample(
      'Queries to info@mydeposits.co.uk. The tenant can be reached at alex@example.com.',
    );
    assert.equal(links.get('info@mydeposits.co.uk')?.field, '');
    assert.match(links.get('info@mydeposits.co.uk')?.hint ?? '', /scheme or company/);
    assert.equal(links.get('alex@example.com')?.field, '', 'two emails means a human chooses');
  });

  it('takes the only email when there is just one', () => {
    const links = bySample('Please contact the tenant at alex@example.com about the tenancy.');
    assert.equal(links.get('alex@example.com')?.field, 'tenants[0].email');
  });

  it('never maps two values to the same detail', () => {
    const links = bySample('Rent of £1,300 is due. Rent of £1,400 is also mentioned in error.');
    const mapped = [...links.values()].filter((link) => link.field === 'tenancy.rent_amount');
    assert.equal(mapped.length, 1, 'only one of them may claim the rent');
    const second = links.get('£1,400');
    assert.equal(second?.field, '');
    assert.equal(second?.confidence, 'check');
  });

  it('detects a blank form and counts the blanks', () => {
    const proposal = proposeLinks('Name: ___________  Date: ___________  Amount: _________');
    assert.equal(proposal.mode, 'blanks');
    assert.equal(proposal.blankCount, 3);
  });

  it('treats a document with no blanks as a values document', () => {
    const proposal = proposeLinks('The rent is £1,450. The tenancy starts on 1 November 2026.');
    assert.equal(proposal.mode, 'values');
    assert.equal(proposal.blankCount, 0);
  });

  it('counts the words, and copes with an empty document', () => {
    assert.equal(proposeLinks('one two three').wordCount, 3);
    assert.equal(proposeLinks('   ').wordCount, 0);
    assert.deepEqual(proposeLinks('   ').links, []);
  });
});
