/**
 * `pnpm docs:check` — keep the documentation honest.
 *
 * Documentation drifts the moment code changes: a rename here, a new command
 * there, and the README quietly describes a version of the app that no longer
 * exists. This script fails the build when the docs and the project disagree, so
 * drift is caught by CI rather than by a customer.
 *
 * It verifies three things:
 *   1. every `pnpm <script>` mentioned in a doc exists in package.json;
 *   2. every repo path written in backticks actually exists;
 *   3. any stated test count matches the number of tests in tests/.
 *
 * Run it after any change to the app, the templates, or the tests.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Problem = { file: string; line: number; message: string };

/** `pnpm` commands that are built in rather than project scripts. */
const PNPM_BUILTINS = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'upgrade',
  'outdated', 'why', 'dlx', 'exec', 'run', 'publish', 'link', 'unlink', 'prune',
  'audit', 'licenses', 'store', 'env', 'config', 'patch', 'patch-commit', 'dedupe',
  'import', 'rebuild', 'root', 'bin', 'list', 'ls', 'recursive', 'filter', 'deploy',
  'fetch', 'init', 'setup', 'doctor',
]);

const PATH_PREFIXES = ['src/', 'docs/', 'tests/', 'scripts/', 'templates/', 'public/', 'samples/', '.github/'];
const ROOT_FILES = new Set([
  'README.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md',
  'Dockerfile', 'docker-compose.yml', 'package.json', 'tsconfig.json',
  '.env.example', '.gitignore', '.dockerignore', '.gitattributes', 'pnpm-lock.yaml',
]);

/** Docs that describe the *current* state and must state the present test count. */
const CURRENT_STATE_DOCS = new Set(['README.md', 'docs/ARCHITECTURE.md', 'CONTRIBUTING.md', 'docs/DEPLOY.md']);

async function docFiles(): Promise<string[]> {
  const files = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md'];
  for (const name of (await readdir('docs')).sort()) {
    if (name.endsWith('.md')) files.push(join('docs', name));
  }
  if (existsSync('samples/README.md')) files.push('samples/README.md');
  return files;
}

async function countTests(): Promise<number> {
  const dir = resolve('tests');
  let total = 0;
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.test.ts')) continue;
    const source = await readFile(join(dir, name), 'utf8');
    // Each `it(` at the start of a statement is one test case.
    total += (source.match(/^\s*it\(/gm) ?? []).length;
  }
  return total;
}

function checkScripts(text: string, file: string, scripts: Set<string>, problems: Problem[]): void {
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\bpnpm\s+([a-z][\w:-]*)/g)) {
      const name = match[1] ?? '';
      if (name === '' || PNPM_BUILTINS.has(name)) continue;
      if (scripts.has(name)) continue;
      problems.push({
        file,
        line: index + 1,
        message: `documents "pnpm ${name}" but package.json has no such script`,
      });
    }
  });
}

function checkPaths(text: string, file: string, problems: Problem[]): void {
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/`([^`\s]+)`/g)) {
      const candidate = (match[1] ?? '').trim();
      const isPath =
        PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix)) || ROOT_FILES.has(candidate);
      if (!isPath) continue;
      // Ignore templates like `src/docs/<name>.ts` or globs.
      if (/[<>*?]/.test(candidate)) continue;
      if (existsSync(resolve(candidate))) continue;
      problems.push({ file, line: index + 1, message: `refers to ${candidate}, which does not exist` });
    }
  });
}

function checkTestCounts(text: string, file: string, actual: number, problems: Problem[]): void {
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\b(\d+)\s+tests\b/gi)) {
      const claimed = Number(match[1]);
      if (!Number.isFinite(claimed)) continue;
      if (claimed === actual) continue;
      problems.push({
        file,
        line: index + 1,
        message: `says ${claimed} tests, but the suite contains ${actual}`,
      });
    }
  });
}

async function main() {
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { scripts?: Record<string, string> };
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  const actualTests = await countTests();
  const problems: Problem[] = [];

  for (const file of await docFiles()) {
    const text = await readFile(file, 'utf8');
    // Normalise separators: on Windows `join('docs', x)` yields `docs\x.md`, and
    // comparing that to a set of forward-slash paths silently matched nothing.
    const key = file.replace(/\\/g, '/');
    checkScripts(text, file, scripts, problems);
    checkPaths(text, file, problems);
    // Changelog entries are history: an old release really did have 141 tests.
    if (CURRENT_STATE_DOCS.has(key)) checkTestCounts(text, file, actualTests, problems);
  }

  console.log('');
  console.log('  Documentation check');
  console.log('  ' + '─'.repeat(58));
  console.log(`  ${problems.length === 0 ? '✓' : '✗'} ${problems.length} problem(s) found`);
  console.log(`  Test suite: ${actualTests} tests`);

  if (problems.length > 0) {
    console.log('');
    for (const problem of problems) {
      console.log(`  ${problem.file}:${problem.line}  ${problem.message}`);
    }
    console.log('');
    console.log('  Update the documentation above so it matches the app.');
    console.log('');
    process.exit(1);
  }

  console.log('  Every documented command, path and test count matches the code.');
  console.log('');
}

await main();
