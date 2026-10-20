import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { Store } from '../src/db.ts';
import { BackOffice } from '../src/backoffice/entities.ts';
import { aggregateDue, dueSoonFor } from '../src/backoffice/due.ts';
import { buildCalendar } from '../src/util/ics.ts';
import { completeFields, tempDir } from './helpers.ts';

const TODAY = new Date(2026, 9, 19); // 19 October 2026

function setup() {
  const store = new Store(tempDir('td-due-'));
  const backOffice = new BackOffice(store.handle);
  return { store, backOffice };
}

describe('what is due', () => {
  it('gathers every statutory date from every tenancy, oldest first', () => {
    const { store, backOffice } = setup();
    const pack = store.createPack({
      ...completeFields(),
      'tenancy.start_date': '2026-11-01',
      'tenancy.deposit_received_date': '2026-10-20',
      'safety.gas_safety_date': '2026-09-15',
      'safety.eicr_date': '2026-02-01',
    });
    store.linkPack(pack.id, { lifecycle: 'active' });

    const report = aggregateDue(store, backOffice, TODAY);
    const kinds = report.items.map((item) => item.kind);
    for (const kind of ['deposit-protection', 'written-statement', 'gas-safety', 'eicr'] as const) {
      assert.ok(kinds.includes(kind), `expected a ${kind} deadline`);
    }
    const dates = report.items.map((item) => item.date);
    assert.deepEqual(dates, [...dates].sort(), 'sorted by date');
    store.close();
  });

  it('counts down to each date, and flags the ones already passed', () => {
    const { store, backOffice } = setup();
    const pack = store.createPack({
      ...completeFields(),
      'tenancy.start_date': '2026-11-01',
      'tenancy.deposit_received_date': '2026-08-01', // well past the 30 days
      'safety.gas_safety_date': '2026-09-15',
      'safety.eicr_date': '2026-02-01',
    });
    store.linkPack(pack.id, { lifecycle: 'active' });

    const report = aggregateDue(store, backOffice, TODAY);
    const deposit = report.items.find((item) => item.kind === 'deposit-protection');
    assert.equal(deposit?.date, '2026-08-31');
    assert.ok((deposit?.daysUntil ?? 0) < 0, 'that date has passed');
    assert.equal(report.overdue >= 1, true);
    store.close();
  });

  it('reminds you a tenancy is about to start', () => {
    const { store, backOffice } = setup();
    const pack = store.createPack({ ...completeFields(), 'tenancy.start_date': '2026-11-01' });
    store.linkPack(pack.id, { lifecycle: 'upcoming' });

    const report = aggregateDue(store, backOffice, TODAY);
    const start = report.items.find((item) => item.kind === 'start');
    assert.equal(start?.date, '2026-11-01');
    assert.equal(start?.daysUntil, 13);
    store.close();
  });

  it('leaves ended tenancies out', () => {
    const { store, backOffice } = setup();
    const pack = store.createPack({ ...completeFields(), 'tenancy.start_date': '2026-11-01' });
    store.linkPack(pack.id, { lifecycle: 'ended' });

    assert.deepEqual(aggregateDue(store, backOffice, TODAY).items, []);
    store.close();
  });

  it('counts the dates close enough to matter, for the sidebar', () => {
    const fields = {
      ...completeFields(),
      'tenancy.start_date': '2026-11-01',
      'tenancy.deposit_received_date': '2026-10-20',
    };
    // From 1 November: deposit protection is 18 days away, written statement 28.
    assert.equal(dueSoonFor(fields, new Date(2026, 10, 1)), 2);
    // From 19 October both are month-away, so the sidebar stays quiet.
    assert.equal(dueSoonFor(fields, TODAY), 0);
  });
});

describe('the calendar file', () => {
  it('writes a valid all-day calendar', () => {
    const ics = buildCalendar(
      [
        { uid: 'abc-deposit-protection-2026-11-19', date: '2026-11-19', title: 'Protect the deposit' },
        { uid: 'abc-written-statement-2026-11-29', date: '2026-11-29', title: 'Give the written statement', description: 'TD-2026-0001' },
      ],
      { name: 'Tenancy deadlines', now: new Date(Date.UTC(2026, 9, 19, 9, 0, 0)) },
    );

    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /END:VCALENDAR\r\n$/);
    assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
    assert.match(ics, /DTSTART;VALUE=DATE:20261119/);
    assert.match(ics, /SUMMARY:Protect the deposit/);
    assert.match(ics, /PRODID:-\/\/TenancyDesk/);
    assert.match(ics, /X-WR-CALNAME:Tenancy deadlines/);
  });

  it('escapes the characters that would break the format', () => {
    const ics = buildCalendar([{ uid: 'x', date: '2026-11-19', title: 'Rent, deposit; and fees' }]);
    assert.match(ics, /SUMMARY:Rent\\, deposit\\; and fees/);
  });

  it('reminds the day before and on the day', () => {
    const ics = buildCalendar([{ uid: 'x', date: '2026-11-19', title: 'Protect the deposit' }]);
    assert.match(ics, /TRIGGER:-P1D/);
    assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 1);
  });

  it('uses CRLF line endings, as the specification requires', () => {
    const ics = buildCalendar([{ uid: 'x', date: '2026-11-01', title: 'Start' }]);
    assert.equal(ics.includes('\r\n'), true);
  });
});
