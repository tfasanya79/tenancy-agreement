import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { runComplianceChecks } from '../src/docs/compliance.ts';
import { reviewGate } from '../src/docs/gate.ts';
import { completeFields } from './helpers.ts';

const TODAY = new Date(2026, 9, 19);
const clean = runComplianceChecks(completeFields(), { today: TODAY });
const incomplete = runComplianceChecks({}, { today: TODAY });

describe('the review gate', () => {
  it('never blocks in relaxed mode — it asks', () => {
    const gate = reviewGate(incomplete, 'relaxed');
    assert.equal(gate.canGenerate, true, 'the agency may always produce their own paperwork');
    assert.equal(gate.needsConfirmation, true);
    assert.ok(gate.outstanding.length > 0);
  });

  it('blocks only when strict mode is switched on', () => {
    const gate = reviewGate(incomplete, 'strict');
    assert.equal(gate.canGenerate, false);
    assert.equal(gate.needsConfirmation, true);
    assert.match(gate.message, /Strict mode/);
  });

  it('asks nothing when there is nothing outstanding', () => {
    for (const mode of ['relaxed', 'strict'] as const) {
      const gate = reviewGate(clean, mode);
      assert.equal(gate.needsConfirmation, false);
      assert.equal(gate.canGenerate, true);
    }
  });

  it('puts only the serious findings in front of them', () => {
    const gate = reviewGate(incomplete, 'relaxed');
    assert.ok(gate.outstanding.every((finding) => finding.severity === 'error'));
  });

  it('gives the assistant something it can say out loud', () => {
    const gate = reviewGate(incomplete, 'relaxed');
    assert.match(gate.message, /worth fixing/);
    assert.match(gate.message, /ask whether to carry on/);
  });
});
