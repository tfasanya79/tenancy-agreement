import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { Store } from '../src/db.ts';
import { BackOffice } from '../src/backoffice/entities.ts';
import { contextFor, effectiveFields } from '../src/backoffice/context.ts';
import { resolveFields } from '../src/backoffice/inheritance.ts';
import { applyMigration, previewMigration } from '../src/backoffice/migrate.ts';
import { TemplateRegistry } from '../src/docs/registry.ts';
import { generateDocuments } from '../src/docs/generate.ts';
import { AGREEMENT_TEMPLATE, completeFields, tempDir, writeTemplate } from './helpers.ts';

function setup() {
  const store = new Store(tempDir('td-bo-'));
  const backOffice = new BackOffice(store.handle);
  backOffice.saveSettings({
    name: 'Haven Bricks Properties Ltd',
    address: '13 Montagu Gardens, Dartford, Kent, DA1 5RP',
    email: 'office@example.test',
    phone: '07403 401298',
    clientMoneyScheme: 'Propertymark Client Money Protection',
    redressScheme: 'The Property Ombudsman',
    negotiator: 'Mary J Ajala',
  });
  const landlord = backOffice.createLandlord({ name: 'Priya Raman', address: '4 Oak Lane, Leeds LS1 4AB' });
  const property = backOffice.createProperty({
    landlordId: landlord.id,
    addressLine1: '14 Beech Road',
    city: 'London',
    postcode: 'E17 3NU',
    epcRating: 'C',
    propertyType: 'House',
  });
  const room = backOffice.createRoom({
    propertyId: property.id,
    roomNumber: '2',
    rentAmount: 1450,
    depositAmount: 1673,
    status: 'let',
  });
  return { store, backOffice, landlord, property, room };
}

describe('inheritance', () => {
  it('builds a full set of details from three typed values', () => {
    const { store, backOffice, landlord, property, room } = setup();

    // Only these three are typed for a new tenancy.
    const pack = store.createPack({
      tenants: [{ full_name: 'Alex Morgan', email: 'alex@example.com' }],
      'tenancy.start_date': '2026-11-01',
    });
    store.linkPack(pack.id, {
      landlordId: landlord.id,
      propertyId: property.id,
      roomId: room.id,
      lifecycle: 'upcoming',
    });

    const context = contextFor(store.getPack(pack.id), backOffice);
    const fields = context.resolved.values;

    assert.equal(fields['property.address_line1'], '14 Beech Road');
    assert.equal(fields['property.postcode'], 'E17 3NU');
    assert.equal(fields['property.room_number'], '2');
    assert.equal(fields['landlord.full_name'], 'Priya Raman');
    assert.equal(fields['landlord.address'], '4 Oak Lane, Leeds LS1 4AB');
    assert.equal(fields['agent.company_name'], 'Haven Bricks Properties Ltd');
    assert.equal(fields['agent.redress_scheme'], 'The Property Ombudsman');
    assert.equal(fields['tenancy.rent_amount'], 1450);
    assert.equal(fields['tenancy.deposit_amount'], 1673);
    assert.equal(fields['tenancy.payment_date'], '2026-10-31', 'derived the day before');
    assert.equal(fields['property.epc_rating'], 'C');

    // Nothing essential is missing even though only three things were typed.
    assert.deepEqual(context.resolved.missing, []);
  });

  it('says where every value came from', () => {
    const { store, backOffice, landlord, property, room } = setup();
    const pack = store.createPack({ tenants: [{ full_name: 'Alex Morgan' }], 'tenancy.start_date': '2026-11-01' });
    store.linkPack(pack.id, { landlordId: landlord.id, propertyId: property.id, roomId: room.id });

    const { provenance } = contextFor(store.getPack(pack.id), backOffice).resolved;
    assert.equal(provenance['agent.company_name'], 'agency');
    assert.equal(provenance['landlord.full_name'], 'landlord');
    assert.equal(provenance['property.postcode'], 'property');
    assert.equal(provenance['property.room_number'], 'room');
    assert.equal(provenance['tenants'], 'tenancy');
    assert.equal(provenance['tenancy.payment_date'], 'derived');
  });

  it('lets the tenancy override what it inherits', () => {
    const { store, backOffice, room, property, landlord } = setup();
    const pack = store.createPack({
      tenants: [{ full_name: 'Alex Morgan' }],
      'tenancy.start_date': '2026-11-01',
      // A one-off rent agreed with this tenant, different from the room default.
      'tenancy.rent_amount': 1500,
    });
    store.linkPack(pack.id, { landlordId: landlord.id, propertyId: property.id, roomId: room.id });

    const context = contextFor(store.getPack(pack.id), backOffice);
    assert.equal(context.resolved.values['tenancy.rent_amount'], 1500);
    assert.equal(context.resolved.provenance['tenancy.rent_amount'], 'tenancy');
    assert.ok(context.resolved.overrides.includes('tenancy.rent_amount'));
  });

  it('treats an empty value as "go back to inherited"', () => {
    const merged = resolveFields({
      tenancy: { 'tenancy.rent_amount': '', 'tenants': [{ full_name: 'Alex' }] },
      agency: {
        name: '', address: '', phone: '', email: '',
        clientMoneyScheme: '', redressScheme: '', negotiator: '', rentAccount: '', reviewMode: 'relaxed',
      },
      room: {
        id: 'r', propertyId: 'p', roomNumber: '2', rentAmount: 1300,
        rentFrequency: 'Monthly', depositAmount: null, status: 'let',
      },
    });
    assert.equal(merged.values['tenancy.rent_amount'], 1300);
    assert.equal(merged.provenance['tenancy.rent_amount'], 'room');
  });

  it('falls back to a linked tenant record', () => {
    const { backOffice, store, room, property, landlord } = setup();
    const tenant = backOffice.createTenant({ fullName: 'Sam Okafor', email: 'sam@example.com' });
    const pack = store.createPack({ 'tenancy.start_date': '2026-11-01' });
    store.linkPack(pack.id, {
      landlordId: landlord.id,
      propertyId: property.id,
      roomId: room.id,
      tenantId: tenant.id,
    });

    const fields = effectiveFields(store.getPack(pack.id), backOffice);
    const tenants = fields['tenants'] as Array<Record<string, unknown>>;
    assert.equal(tenants[0]?.['full_name'], 'Sam Okafor');
    assert.equal(tenants[0]?.['email'], 'sam@example.com');
  });
});

describe('shared values', () => {
  it('knows how many tenancies inherit a room, so it can warn first', () => {
    const { store, backOffice, landlord, property, room } = setup();

    const first = store.createPack({ tenants: [{ full_name: 'Alex Morgan' }], 'tenancy.start_date': '2026-11-01' });
    const second = store.createPack({ tenants: [{ full_name: 'Sam Okafor' }], 'tenancy.start_date': '2026-12-01' });
    store.linkPack(first.id, { landlordId: landlord.id, propertyId: property.id, roomId: room.id });
    store.linkPack(second.id, { landlordId: landlord.id, propertyId: property.id, roomId: room.id });

    assert.equal(backOffice.countTenanciesUsing('room_id', room.id), 2);
    assert.equal(store.tenanciesUsing('room_id', room.id).length, 2);

    const summary = backOffice.roomSummary().find((entry) => entry.id === room.id);
    assert.equal(summary?.tenancyCount, 2);
    assert.match(summary?.propertyAddress ?? '', /14 Beech Road/);
    store.close();
  });

  it('does not count a tenancy that has ended', () => {
    const { store, backOffice, landlord, property, room } = setup();
    const pack = store.createPack({ tenants: [{ full_name: 'Past Tenant' }], 'tenancy.start_date': '2025-01-01' });
    store.linkPack(pack.id, {
      landlordId: landlord.id,
      propertyId: property.id,
      roomId: room.id,
      lifecycle: 'ended',
    });

    assert.equal(backOffice.countTenanciesUsing('room_id', room.id), 0, 'an ended tenancy is history, not a risk');
    assert.equal(store.tenanciesUsing('room_id', room.id).length, 1, 'but it is still on record');
    store.close();
  });
});

describe('a prefilled tenancy produces a real document', () => {
  it('renders the inherited address, room and landlord into the agreement', async () => {
    const { store, backOffice, landlord, property, room } = setup();
    const templatesDir = join(tempDir('td-bo-tpl-'), 'templates');
    writeTemplate(templatesDir, 'agreement.md', AGREEMENT_TEMPLATE);
    const registry = await TemplateRegistry.load(templatesDir);

    const pack = store.createPack({
      tenants: [{ full_name: 'Alex Morgan', email: 'alex@example.com' }],
      'tenancy.start_date': '2026-11-01',
    });
    store.linkPack(pack.id, { landlordId: landlord.id, propertyId: property.id, roomId: room.id });

    const generated = await generateDocuments({
      store,
      registry,
      packId: pack.id,
      fields: effectiveFields(store.getPack(pack.id), backOffice),
    });

    assert.equal(generated.length, 1);
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(join(store.dataDir, generated[0]!.htmlPath ?? ''), 'utf8');

    assert.match(html, /14 Beech Road/, 'the property address is inherited');
    assert.match(html, /Priya Raman/, 'the landlord is inherited');
    assert.match(html, /£1,450/, 'the rent comes from the room');
    assert.match(html, /1 November 2026/);
    store.close();
  });
});

describe('migration of existing packs', () => {
  const packFields = (roomNumber: string, tenant: string, rent: number): Record<string, unknown> => ({
    ...completeFields(),
    'property.room_number': roomNumber,
    'tenancy.rent_amount': rent,
    tenants: [{ full_name: tenant, email: `${tenant.split(' ')[0]?.toLowerCase()}@example.com` }],
  });

  it('proposes one property with two rooms, not two properties', () => {
    const store = new Store(tempDir('td-mig-'));
    store.createPack(packFields('1', 'Alex Morgan', 1200));
    store.createPack(packFields('2', 'Sam Okafor', 1300));

    const plan = previewMigration(store.listPacks());
    assert.equal(plan.properties.length, 1, 'same address means one property');
    assert.equal(plan.rooms.length, 2);
    assert.equal(plan.landlords.length, 1);
    assert.equal(plan.tenants.length, 2);
    assert.equal(plan.links.length, 2);
    store.close();
  });

  it('writes nothing until it is confirmed', () => {
    const store = new Store(tempDir('td-mig2-'));
    const backOffice = new BackOffice(store.handle);
    store.createPack(packFields('1', 'Alex Morgan', 1200));

    const plan = previewMigration(store.listPacks());
    assert.ok(plan.properties.length > 0);
    assert.equal(backOffice.stats().properties, 0, 'a preview must not write');
    store.close();
  });

  it('links the packs and keeps their details', () => {
    const store = new Store(tempDir('td-mig3-'));
    const backOffice = new BackOffice(store.handle);
    const before = store.createPack(packFields('1', 'Alex Morgan', 1200));
    const fieldsBefore = JSON.stringify(before.fields);

    const plan = previewMigration(store.listPacks());
    const result = applyMigration(plan, backOffice, store);

    assert.equal(result.linked, 1);
    assert.equal(backOffice.stats().properties, 1);
    assert.equal(backOffice.stats().rooms, 1);

    const after = store.getPack(before.id);
    assert.notEqual(after.propertyId, null, 'the pack now points at a property');
    assert.notEqual(after.roomId, null);
    assert.equal(JSON.stringify(after.fields), fieldsBefore, 'nothing was taken away');
    assert.equal(after.lifecycle, 'upcoming', 'a tenancy that has not started yet is upcoming');
    store.close();
  });

  it('marks a tenancy that has already started as active', () => {
    const store = new Store(tempDir('td-mig6-'));
    const backOffice = new BackOffice(store.handle);
    const pack = store.createPack({
      ...completeFields(),
      'property.room_number': '3',
      'tenancy.start_date': '2025-02-01',
      tenants: [{ full_name: 'Past Tenant' }],
    });

    applyMigration(previewMigration(store.listPacks()), backOffice, store);
    assert.equal(store.getPack(pack.id).lifecycle, 'active');
    store.close();
  });

  it('warns instead of guessing when there is no address', () => {
    const store = new Store(tempDir('td-mig4-'));
    const pack = store.createPack({ tenants: [{ full_name: 'Alex Morgan' }], 'landlord.full_name': 'Priya Raman' });
    const plan = previewMigration(store.listPacks());
    assert.equal(plan.properties.length, 0);
    assert.ok(plan.warnings.some((warning) => warning.includes(pack.reference)));
    store.close();
  });

  it('does not double-migrate an already linked pack', () => {
    const store = new Store(tempDir('td-mig5-'));
    const backOffice = new BackOffice(store.handle);
    store.createPack(packFields('1', 'Alex Morgan', 1200));
    applyMigration(previewMigration(store.listPacks()), backOffice, store);

    const second = previewMigration(store.listPacks());
    assert.equal(second.links.length, 0);
    assert.equal(second.alreadyLinked, 1);
    store.close();
  });
});
