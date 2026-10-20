import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { Store } from '../src/db.ts';
import { buildBackup, healthOf } from '../src/backoffice/backup.ts';
import { readZip } from '../src/util/zip.ts';
import { completeFields, tempDir } from './helpers.ts';

describe('the backup', () => {
  it('contains the database, the documents and the uploads', async () => {
    const store = new Store(tempDir('td-bak-'));
    const pack = store.createPack(completeFields());

    // Pretend a document was generated, and an original uploaded.
    writeFileSync(join(store.documentDir(pack.id), 'agreement.docx'), Buffer.from('PK fake docx'));
    const uploads = join(store.dataDir, 'uploads');
    mkdirSync(uploads, { recursive: true });
    writeFileSync(join(uploads, 'theirs.docx'), Buffer.from('PK fake upload'));

    const backup = await buildBackup(store.handle, store.dataDir);
    const names = [...readZip(backup.buffer).keys()];

    assert.ok(names.includes('tenancydesk.db'), 'the database is in the archive');
    assert.ok(names.includes('README - how to restore.txt'), 'restore instructions are in the archive');
    assert.ok(
      names.some((name) => name.startsWith('documents/') && name.endsWith('.docx')),
      `expected a generated document, got ${names.join(', ')}`,
    );
    assert.ok(
      names.some((name) => name.startsWith('uploads/') && name.endsWith('theirs.docx')),
      `expected the uploaded original, got ${names.join(', ')}`,
    );
    assert.ok(backup.bytes > 0);
    store.close();
  });

  it('copies the database in a state that opens and still holds the data', async () => {
    const store = new Store(tempDir('td-bak2-'));
    const pack = store.createPack(completeFields());
    store.updatePack(pack.id, { notes: [{ id: 'n1', text: 'Remember the deposit', createdAt: new Date().toISOString() }] });

    const backup = await buildBackup(store.handle, store.dataDir);
    const dbBytes = readZip(backup.buffer).get('tenancydesk.db');
    assert.ok(dbBytes !== undefined);

    // Written out and opened as a real database: this is what a restore does.
    const restoredPath = join(tempDir('td-bak2-restore-'), 'tenancydesk.db');
    writeFileSync(restoredPath, dbBytes);
    const restored = new DatabaseSync(restoredPath);
    const row = restored.prepare('SELECT reference, notes_json FROM packs').get() as
      | { reference: string; notes_json: string }
      | undefined;
    assert.equal(row?.reference, pack.reference);
    assert.match(row?.notes_json ?? '', /Remember the deposit/);
    restored.close();
    store.close();
  });

  it('reports what is on disk', async () => {
    const store = new Store(tempDir('td-bak3-'));
    const pack = store.createPack(completeFields());
    writeFileSync(join(store.documentDir(pack.id), 'one.docx'), Buffer.from('PK one'));

    const health = await healthOf(store.handle, store.dataDir);
    assert.ok(health.databaseBytes > 0);
    assert.equal(health.documentCount, 1);
    assert.equal(health.dataDir, store.dataDir);
    store.close();
  });
});
