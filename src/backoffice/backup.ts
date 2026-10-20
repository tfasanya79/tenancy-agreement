/**
 * One zip that contains everything needed to put the app back as it is now.
 *
 * The database, every generated document, and every document the agency uploaded.
 * It is taken with `VACUUM INTO`, which writes a consistent copy while the app keeps
 * running — copying the file by hand while SQLite is writing can produce a backup
 * that will not open.
 *
 * Nobody is going to run rsync. So this is a button.
 */

import { statfs } from 'node:fs/promises';
import { readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { createZip, type ZipEntry } from '../util/zip.ts';

export type BackupResult = {
  buffer: Buffer;
  /** How many files went in, and how big the archive is. */
  files: number;
  bytes: number;
  databaseBytes: number;
};

const RESTORE_NOTE = `TenancyDesk backup
==================

This archive contains:

  tenancydesk.db     the database — every tenancy, message, note and audit log
  documents/         every document the app generated, per tenancy
  uploads/           the original Word files the agency uploaded
  README - how to restore.txt   this file

HOW TO RESTORE
--------------

1. Stop TenancyDesk (Ctrl+C in the window running it, or: docker compose down).
2. Make a copy of your current data folder first, in case you are restoring the
   wrong backup.
3. Empty the data folder, then copy the contents of this archive into it, so that
   tenancydesk.db sits at the top of the data folder.
4. Start TenancyDesk again.

If you use Docker, the folder to restore into is the "tenancydesk-data" volume.
See docs/DEPLOY.md in the project for the exact commands.

The database was copied with SQLite's VACUUM INTO, so it is a single consistent
file — you do not need the -wal or -shm files.
`;

/**
 * Build the archive.
 * @param db    the live database connection
 * @param dataDir the folder holding the database, documents and uploads
 */
export async function buildBackup(db: DatabaseSync, dataDir: string): Promise<BackupResult> {
  const entries: ZipEntry[] = [];

  // A consistent copy of the database, without stopping anything.
  const snapshot = join(tmpdir(), `tenancydesk-backup-${randomUUID()}.db`);
  let databaseBytes = 0;
  try {
    db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
    const data = await readFile(snapshot);
    databaseBytes = data.byteLength;
    entries.push({ name: 'tenancydesk.db', data });
  } finally {
    await rm(snapshot, { force: true });
  }

  // Generated documents and uploaded originals, keeping their folder structure.
  for (const folder of ['documents', 'uploads']) {
    const root = join(dataDir, folder);
    let files: string[];
    try {
      files = (await readdir(root, { recursive: true })) as string[];
    } catch {
      continue;
    }
    for (const file of files) {
      const full = join(root, file);
      try {
        const data = await readFile(full);
        entries.push({ name: `${folder}/${relative(root, full).replace(/\\/g, '/')}`, data });
      } catch {
        // A folder entry, or a file that vanished mid-read. Skip it.
      }
    }
  }

  entries.push({ name: 'README - how to restore.txt', data: RESTORE_NOTE });

  const buffer = createZip(entries);
  return { buffer, files: entries.length, bytes: buffer.byteLength, databaseBytes };
}

export type HealthReport = {
  dataDir: string;
  databaseBytes: number;
  documentCount: number;
  uploadCount: number;
  freeBytes: number | null;
  totalBytes: number | null;
};

/** How much is in the data folder, and how much room is left on the disk. */
export async function healthOf(db: DatabaseSync, dataDir: string): Promise<HealthReport> {
  const countFiles = async (folder: string): Promise<number> => {
    try {
      const files = (await readdir(join(dataDir, folder), { recursive: true })) as string[];
      let count = 0;
      for (const file of files) {
        try {
          const data = await readFile(join(dataDir, folder, file));
          if (data.byteLength > 0) count += 1;
        } catch {
          // not a file
        }
      }
      return count;
    } catch {
      return 0;
    }
  };

  let databaseBytes = 0;
  try {
    databaseBytes = (await readFile(join(dataDir, 'tenancydesk.db'))).byteLength;
  } catch {
    databaseBytes = 0;
  }

  let freeBytes: number | null = null;
  let totalBytes: number | null = null;
  try {
    const stats = await statfs(dataDir);
    freeBytes = stats.bavail * stats.bsize;
    totalBytes = stats.blocks * stats.bsize;
  } catch {
    // Not every platform reports this; the panel simply leaves it out.
  }

  return {
    dataDir,
    databaseBytes,
    documentCount: await countFiles('documents'),
    uploadCount: await countFiles('uploads'),
    freeBytes,
    totalBytes,
  };
}
