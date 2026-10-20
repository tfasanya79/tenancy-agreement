/**
 * Durability of the SQLite file.
 *
 * The database runs in WAL mode, so a committed change lands in `tenancydesk.db-wal`
 * first and only moves into `tenancydesk.db` at a checkpoint. On a live installation
 * that log was once removed from under the running app, and a day's work went with
 * it — the app kept serving, and the `.db` on disk looked empty.
 *
 * These tests pin the two defences: the log is folded in on demand, and the database
 * file alone is then a complete copy of everything.
 */

import { strict as assert } from 'node:assert';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';

import { Store } from '../src/db.ts';
import { tempDir } from './helpers.ts';

const walSize = (dir: string): number => {
  const path = join(dir, 'tenancydesk.db-wal');
  return existsSync(path) ? statSync(path).size : 0;
};

it('a write goes to the log first, and a checkpoint moves it into the database', () => {
  const dir = tempDir('td-wal-');
  const store = new Store(dir);
  try {
    store.createPack({ 'landlord.full_name': 'Priya Raman' });

    // The pack is committed, but it is still in the write-ahead log.
    assert.ok(walSize(dir) > 0, 'a committed write should appear in the log');

    store.checkpoint();

    assert.equal(walSize(dir), 0, 'a checkpoint should leave an empty log');
  } finally {
    store.close();
  }

  // With the log empty, a fresh reader sees the data in the database file itself.
  const reopened = new Store(dir);
  try {
    assert.equal(reopened.listPacks().length, 1, 'the pack should survive in the database file');
  } finally {
    reopened.close();
  }
});

it('closing the store checkpoints, so the file on disk is complete', () => {
  const dir = tempDir('td-wal-close-');
  const store = new Store(dir);
  store.createPack({ 'landlord.full_name': 'Ade Bello' });
  assert.ok(walSize(dir) > 0);
  store.close();

  assert.equal(walSize(dir), 0, 'closing should checkpoint the log');

  const reopened = new Store(dir);
  try {
    assert.equal(reopened.listPacks().length, 1);
  } finally {
    reopened.close();
  }
});

it('reads look at the log as well, so a backup taken without a checkpoint is still whole', () => {
  const dir = tempDir('td-wal-read-');
  const writer = new Store(dir);
  try {
    writer.createPack({ 'landlord.full_name': 'Mary Ajala' });
    assert.ok(walSize(dir) > 0, 'the write is in the log at this point');

    // A second connection — which is what the backup script opens — must see it.
    const reader = new Store(dir);
    try {
      assert.equal(reader.listPacks().length, 1, 'a reader must see through the log');
    } finally {
      reader.close();
    }
  } finally {
    writer.close();
  }
});
