/**
 * TenancyDesk — entry point.
 *
 * `pnpm start` runs this file directly. Node 24+ executes TypeScript on its own,
 * so there is nothing to compile and no build step to forget.
 */

import { mkdirSync } from 'node:fs';

import { loadConfig } from './config.ts';
import { Store } from './db.ts';
import { TemplateRegistry } from './docs/registry.ts';
import { buildApp } from './app.ts';

const config = loadConfig();

mkdirSync(config.dataDir, { recursive: true });

let registry: TemplateRegistry;
try {
  registry = await TemplateRegistry.load(config.templatesDir);
} catch (error) {
  console.error('');
  console.error('  TenancyDesk could not start.');
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  console.error('');
  console.error('  Tip: run the app from the folder that contains "templates/", for example:');
  console.error('    cd tenancy-agreement && pnpm start');
  console.error('');
  process.exit(1);
}

const store = new Store(config.dataDir);
const app = await buildApp({ config, store, registry });

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  console.error('');
  console.error('  TenancyDesk could not start the web server.');
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  console.error('');
  console.error(`  Is something else already using port ${config.port}? Change PORT in your .env file.`);
  console.error('');
  process.exit(1);
}

const url = `http://localhost:${config.port}`;
const keyLine = config.offlineMode
  ? 'switched off (OFFLINE_MODE) — you can still fill in packs by hand'
  : config.deepseekApiKey !== ''
    ? `ready (${config.deepseekModel})`
    : 'no API key — the assistant is off, everything else still works';

console.log('');
console.log('  ┌─────────────────────────────────────────────────────────────┐');
console.log('  │  TenancyDesk                                                │');
console.log('  └─────────────────────────────────────────────────────────────┘');
console.log('');
console.log(`  Open your browser at:  ${url}`);
console.log('');
console.log(`  Assistant:  ${keyLine}`);
console.log(`  Templates:  ${registry.size} loaded from ${config.templatesDir}`);
console.log(`  Your data:  ${config.dataDir}  (back this folder up)`);
console.log('');
if (!config.offlineMode && config.deepseekApiKey === '') {
  console.log('  To switch the assistant on, put your key in .env:');
  console.log('      DEEPSEEK_API_KEY=sk-...');
  console.log('  Then restart. See docs/DEEPSEEK.md.');
  console.log('');
}
if (registry.warnings.length > 0) {
  console.log(`  ${registry.warnings.length} template warning(s):`);
  for (const warning of registry.warnings) console.log(`      - ${warning}`);
  console.log('');
}
console.log('  Press Ctrl+C to stop.');
console.log('');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log('\n  Stopping TenancyDesk...');
    void app.close().then(() => {
      store.close();
      process.exit(0);
    });
  });
}
