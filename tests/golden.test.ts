import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import { TemplateRegistry } from '../src/docs/registry.ts';
import { buildGolden, fingerprint, GOLDEN_PATH, type GoldenFile } from '../scripts/golden.ts';
import { completeFields } from './helpers.ts';

describe('shipped templates do not change by accident', () => {
  it('renders exactly what was recorded', async () => {
    const recorded = JSON.parse(await readFile(GOLDEN_PATH, 'utf8')) as GoldenFile;
    const registry = await TemplateRegistry.load('./templates');
    const fields = completeFields();

    const changed: string[] = [];
    const missing: string[] = [];

    for (const summary of registry.list()) {
      const expected = recorded.templates[summary.id];
      if (expected === undefined) {
        missing.push(summary.id);
        continue;
      }
      const actual = fingerprint(registry.get(summary.id), fields);
      if (actual.sha !== expected.sha) {
        changed.push(`${summary.id}: ${expected.words} words → ${actual.words} words`);
      }
    }

    assert.deepEqual(
      changed,
      [],
      `A template's wording changed:\n  ${changed.join('\n  ')}\n\n` +
        'If that was intended, run `pnpm golden` and commit the updated file alongside the template.',
    );
    assert.deepEqual(missing, [], `New template(s) with no recorded fingerprint: ${missing.join(', ')}. Run \`pnpm golden\`.`);
  });

  it('records every template that ships', async () => {
    const recorded = JSON.parse(await readFile(GOLDEN_PATH, 'utf8')) as GoldenFile;
    const registry = await TemplateRegistry.load('./templates');
    assert.equal(Object.keys(recorded.templates).length, registry.size);
  });

  it('produces the same fingerprints the recorder would', async () => {
    // Guards against the recorder and the test drifting apart.
    const fresh = await buildGolden();
    const recorded = JSON.parse(await readFile(GOLDEN_PATH, 'utf8')) as GoldenFile;
    assert.deepEqual(Object.keys(fresh.templates).sort(), Object.keys(recorded.templates).sort());
    for (const [id, entry] of Object.entries(fresh.templates)) {
      assert.equal(entry.sha, recorded.templates[id]?.sha, `${id} differs between recorder and test`);
    }
  });
});
