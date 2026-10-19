/**
 * `pnpm doctor` — a friendly health check.
 *
 * The audience for this project is a letting agent, not a developer. When
 * something is wrong, this prints one line per thing it looked at and says
 * exactly what to do next.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connect } from 'node:net';

import { loadConfig } from '../src/config.ts';
import { TemplateRegistry } from '../src/docs/registry.ts';

type Check = { ok: boolean; label: string; detail: string };

const results: Check[] = [];
const record = (ok: boolean, label: string, detail: string) => {
  results.push({ ok, label, detail });
};

function nodeVersionOk(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  return major > 24 || (major === 24 && minor >= 0);
}

async function portFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host: host === '0.0.0.0' ? '127.0.0.1' : host, port });
    const done = (free: boolean) => {
      socket.destroy();
      resolvePromise(free);
    };
    socket.once('connect', () => done(false));
    socket.once('error', () => done(true));
    setTimeout(() => done(true), 1200);
  });
}

async function checkDeepSeek(baseUrl: string, apiKey: string): Promise<Check> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return { ok: true, label: 'DeepSeek connection', detail: 'The key works.' };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, label: 'DeepSeek connection', detail: 'DeepSeek rejected the key. Check DEEPSEEK_API_KEY.' };
    }
    return { ok: false, label: 'DeepSeek connection', detail: `DeepSeek replied ${response.status}.` };
  } catch (error) {
    return {
      ok: false,
      label: 'DeepSeek connection',
      detail: `Could not reach DeepSeek (${error instanceof Error ? error.message : String(error)}). Check the internet connection.`,
    };
  }
}

async function main() {
  const config = loadConfig();

  // 1. Node version ---------------------------------------------------------
  const versionOk = nodeVersionOk();
  record(
    versionOk,
    `Node.js ${process.versions.node}`,
    versionOk ? 'New enough.' : 'TenancyDesk needs Node 24 or newer. Install the current LTS from nodejs.org.',
  );

  // 2. Configuration file ---------------------------------------------------
  const envPath = resolve('.env');
  let envExists = true;
  try {
    readFileSync(envPath, 'utf8');
  } catch {
    envExists = false;
  }
  record(
    envExists,
    '.env file',
    envExists
      ? 'Found.'
      : 'Not found. Copy .env.example to .env, then add your DeepSeek key (see README step 2).',
  );

  // 3. Templates ------------------------------------------------------------
  try {
    const registry = await TemplateRegistry.load(config.templatesDir);
    record(true, `Templates (${registry.size})`, `Loaded from ${config.templatesDir}.`);
    if (registry.warnings.length > 0) {
      record(
        false,
        'Template warnings',
        `${registry.warnings.length} issue(s):\n${registry.warnings.map((warning) => `      · ${warning}`).join('\n')}`,
      );
    }
  } catch (error) {
    record(false, 'Templates', error instanceof Error ? error.message : String(error));
  }

  // 4. Data folder is writable ---------------------------------------------
  try {
    mkdirSync(config.dataDir, { recursive: true });
    const probe = join(config.dataDir, '.doctor-write-test');
    writeFileSync(probe, 'ok', 'utf8');
    rmSync(probe);
    record(true, `Data folder (${config.dataDir})`, 'Writable.');
  } catch (error) {
    record(false, `Data folder (${config.dataDir})`, `Not writable: ${error instanceof Error ? error.message : error}`);
  }

  // 5. Public folder --------------------------------------------------------
  try {
    readFileSync(join(config.publicDir, 'index.html'), 'utf8');
    record(true, 'Interface files', 'Found.');
  } catch {
    record(false, 'Interface files', `Cannot find ${join(config.publicDir, 'index.html')}. Run from the project root.`);
  }

  // 6. API key --------------------------------------------------------------
  if (config.offlineMode) {
    record(true, 'AI assistant', 'Switched off (OFFLINE_MODE). You can still fill in packs by hand.');
  } else if (config.deepseekApiKey === '') {
    record(false, 'AI assistant', 'No DEEPSEEK_API_KEY set. Everything works except the assistant.');
  } else {
    record(true, 'AI assistant', `Key present; model ${config.deepseekModel}.`);
    results.push(await checkDeepSeek(config.deepseekBaseUrl, config.deepseekApiKey));
  }

  // 7. Port -----------------------------------------------------------------
  const free = await portFree(config.host, config.port);
  record(
    free,
    `Web port ${config.port}`,
    free ? 'Free.' : `Something is already using port ${config.port}. Change PORT in .env, or stop the other program.`,
  );

  // Report ------------------------------------------------------------------
  console.log('');
  console.log('  TenancyDesk health check');
  console.log('  ' + '─'.repeat(58));
  for (const check of results) {
    console.log(`  ${check.ok ? '✓' : '✗'}  ${check.label}`);
    console.log(`      ${check.detail}`);
  }
  const failures = results.filter((check) => !check.ok).length;
  console.log('  ' + '─'.repeat(58));
  console.log(
    failures === 0
      ? '  All good. Run: pnpm start'
      : `  ${failures} thing(s) need attention. Fix them above, then run: pnpm doctor`,
  );
  console.log('');
  process.exit(failures === 0 ? 0 : 1);
}

await main();
