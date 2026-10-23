/**
 * The ranked start screen, and what counts as a finished step.
 *
 * The point of these tests is that the ranking and the ticks come from the pack, not from
 * a conversation. If a step could be ticked because a sentence said so, a guide could
 * walk somebody past the review gate and produce documents nobody agreed to.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GUIDES, guideById, rankGuides, type GuideFacts } from '../src/agent/guides.ts';

/** A pack with nothing in it yet. */
const empty = (overrides: Partial<GuideFacts> = {}): GuideFacts => ({
  hasTenant: false,
  missing: [],
  errors: 0,
  warnings: 0,
  documents: 0,
  suggested: 7,
  hasCoverMessage: false,
  uploads: 0,
  mappedUploads: 0,
  isLandlord: false,
  ...overrides,
});

const ids = (facts: GuideFacts): string[] => rankGuides(facts).options.map((option) => option.id);

describe('what is offered, and in what order', () => {
  it('starts an empty pack with the landlord’s email', () => {
    const { options, resume } = rankGuides(empty());
    assert.equal(options[0]?.id, 'start-from-email');
    assert.match(options[0]?.why ?? '', /pull out the dates/i);
    assert.equal(resume, null, 'nothing is under way yet');
  });

  it('offers the way to finish a pack with details missing', () => {
    const facts = empty({ hasTenant: true, missing: ['tenancy.rent_amount', 'landlord.full_name'] });
    const { options } = rankGuides(facts);
    assert.equal(options[0]?.id, 'ready-to-send');
    assert.match(options[0]?.why ?? '', /2 details are still needed/i);
    assert.equal(options[0]?.at, 0, 'the essentials step is the one to do');
  });

  it('says what a single missing detail means, in words', () => {
    const { options } = rankGuides(empty({ hasTenant: true, missing: ['tenancy.rent_amount'] }));
    assert.match(options[0]?.why ?? '', /1 detail is still needed/i);
  });

  it('puts the failing checks in front of everything else once the details are in', () => {
    const facts = empty({ hasTenant: true, documents: 0, errors: 2 });
    const { options } = rankGuides(facts);
    assert.equal(options[0]?.id, 'fix-checks');
    assert.match(options[0]?.why ?? '', /2 items need a look/i);
  });

  it('offers generation when the pack is ready and nothing is produced', () => {
    const facts = empty({ hasTenant: true, documents: 0 });
    const { options } = rankGuides(facts);
    const ready = options.find((option) => option.id === 'ready-to-send');
    assert.ok(ready, 'the guide to finish a pack should be offered');
    assert.equal(ready.steps[ready.at]?.id, 'generate');
    assert.match(ready.why, /7 documents are ready to produce/i);
  });

  it('offers the tenant message once the documents exist', () => {
    const facts = empty({ hasTenant: true, documents: 7, hasCoverMessage: false });
    const { options } = rankGuides(facts);
    assert.equal(options[0]?.id, 'tenant-message');
  });

  it('stops offering the message once it has been written', () => {
    const facts = empty({ hasTenant: true, documents: 7, hasCoverMessage: true });
    const { options } = rankGuides(facts);
    assert.equal(options.some((option) => option.id === 'tenant-message'), false);
    const ready = options.find((option) => option.id === 'ready-to-send');
    // Downloading is the only step left, and it is the one the app cannot see: the
    // interface ticks it when the person takes the file, never the server.
    assert.equal(ready?.steps[ready.at]?.id, 'download');
    assert.equal(ready?.complete, false);
  });

  it('pulls a guide that is half done to the front, and says where it resumes', () => {
    const facts = empty({ hasTenant: true, documents: 0, missing: [] });
    const { options, resume } = rankGuides(facts);
    // ready-to-send is inside the guide, two steps in.
    assert.equal(options[0]?.id, 'ready-to-send');
    assert.deepEqual(resume, { guideId: 'ready-to-send', step: 2 });
  });

  it('offers uploading an agency’s own document when they have not', () => {
    assert.equal(ids(empty({ hasTenant: true, documents: 7, hasCoverMessage: true })).includes('use-our-document'), true);
    const done = rankGuides(empty({ hasTenant: true, documents: 7, hasCoverMessage: true, uploads: 1, mappedUploads: 1 }));
    assert.equal(done.options.some((option) => option.id === 'use-our-document'), false, 'and stops once it is mapped');
  });

  it('offers the mapping when the upload has no values assigned', () => {
    const facts = empty({ hasTenant: true, uploads: 1, mappedUploads: 0 });
    const guide = rankGuides(facts).options.find((option) => option.id === 'use-our-document');
    assert.ok(guide);
    assert.equal(guide.steps[guide.at]?.id, 'map');
  });
});

describe('a landlord gets a different, read-only set', () => {
  it('is never offered a guide that writes', () => {
    const { options } = rankGuides(empty({ isLandlord: true, hasTenant: true, missing: ['tenancy.rent_amount'], documents: 0 }));
    assert.equal(options.length, 1);
    assert.equal(options[0]?.id, 'read-the-pack');
    const writes = ['ready-to-send', 'fix-checks', 'use-our-document', 'tenant-message', 'start-from-email'];
    for (const id of writes) {
      assert.equal(options.some((option) => option.id === id), false, `${id} writes, so a landlord must not see it`);
    }
  });

  it('says how many documents they can read', () => {
    const guide = rankGuides(empty({ isLandlord: true, documents: 3 })).options[0];
    assert.match(guide?.why ?? '', /3 documents/i);
  });
});

describe('done is read from the pack, not claimed', () => {
  it('ticks the essentials step only when nothing is missing', () => {
    const guide = (missing: string[]) =>
      rankGuides(empty({ hasTenant: true, missing, documents: 0 })).options.find((option) => option.id === 'ready-to-send');
    assert.equal(guide(['tenancy.rent_amount'])?.steps[0]?.done, false);
    assert.equal(guide([])?.steps[0]?.done, true);
  });

  it('ticks the checks step only when nothing is flagged as an error', () => {
    const guide = (errors: number) =>
      rankGuides(empty({ hasTenant: true, errors, documents: 0 })).options.find((option) => option.id === 'ready-to-send');
    assert.equal(guide(2)?.steps[1]?.done, false);
    assert.equal(guide(0)?.steps[1]?.done, true);
  });

  it('ticks generation only when documents exist', () => {
    const guide = (documents: number) =>
      rankGuides(empty({ hasTenant: true, documents })).options.find((option) => option.id === 'ready-to-send');
    assert.equal(guide(0)?.steps[2]?.done, false);
    assert.equal(guide(4)?.steps[2]?.done, true);
  });

  it('ticks the message only when one has been saved', () => {
    const guide = (hasCoverMessage: boolean) =>
      rankGuides(empty({ hasTenant: true, documents: 2, hasCoverMessage })).options[0];
    assert.equal(guide(false)?.steps[0]?.done, false);
    assert.equal(guide(true)?.steps[0]?.done, true);
  });

  it('never ticks downloading: the app cannot know it happened', () => {
    const guide = rankGuides(empty({ hasTenant: true, documents: 2 })).options.find((option) => option.id === 'ready-to-send');
    const download = guide?.steps.find((step) => step.id === 'download');
    assert.equal(download?.done, false);
  });
});

describe('handover between guides', () => {
  it('exposes the handover target in what it offers', () => {
    const { options } = rankGuides(empty({ hasTenant: true }));
    const start = options.find((option) => option.id === 'start-from-email');
    // With a tenant already in, this guide is not offered; check the offered shape instead.
    const ready = options.find((option) => option.id === 'ready-to-send');
    assert.ok(ready);
    assert.equal(ready.then, null, 'finishing a pack is the end of the road');

    const fresh = rankGuides(empty()).options.find((option) => option.id === 'start-from-email');
    assert.equal(fresh?.then, 'ready-to-send', 'starting from an email leads into finishing the pack');
    assert.equal(start === undefined, true);
  });

  it('only ever hands over to a guide that exists', () => {
    for (const guide of GUIDES) {
      if (guide.then === undefined) continue;
      assert.notEqual(guideById(guide.then), null, `${guide.id} hands over to ${guide.then}, which does not exist`);
    }
  });

  it('offers the handover target as a real option when the first guide is done', () => {
    // A pack that already has a tenant and details: starting from an email is moot, but
    // the guide it hands over to is the one being offered — the chain is consistent.
    const facts = empty({ hasTenant: true, missing: [] });
    const ids = rankGuides(facts).options.map((option) => option.id);
    assert.equal(ids.includes('ready-to-send'), true);
  });
});
describe('the definitions themselves', () => {
  it('marks which steps cost a model call, so the cost is visible', () => {
    const asking = GUIDES.flatMap((guide) => guide.steps.filter((step) => step.usesModel).map((step) => step.id));
    assert.deepEqual([...new Set(asking)].sort(), ['message', 'paste']);
  });

  it('tells every step where to do it by hand, except the ones that are the doing', () => {
    for (const guide of GUIDES) {
      for (const step of guide.steps) {
        assert.equal(typeof step.what, 'string');
        assert.equal(step.what.length > 10, true, `${guide.id}/${step.id} should explain itself`);
      }
    }
  });

  it('finds a guide by id, for a client that remembers one', () => {
    assert.equal(guideById('ready-to-send')?.id, 'ready-to-send');
    assert.equal(guideById('read-the-pack')?.id, 'read-the-pack');
    assert.equal(guideById('no-such-guide'), null);
  });

  it('has unique step ids within each guide', () => {
    for (const guide of GUIDES) {
      const seen = new Set(guide.steps.map((step) => step.id));
      assert.equal(seen.size, guide.steps.length, `${guide.id} repeats a step id`);
    }
  });
});
