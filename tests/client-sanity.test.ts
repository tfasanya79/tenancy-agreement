/**
 * The interface is one long script with no build step, so nothing links it before
 * a browser runs it. That is how `openBackOffice()` shipped while never being
 * written: the Back office button was wired to a function that did not exist, and
 * nothing failed until somebody clicked it.
 *
 * This tokenises `public/app.js` — strings, comments and regexes are skipped
 * properly, so their contents cannot look like code — and checks that every
 * function it calls is declared somewhere in the file, or is a name the browser
 * provides. It is not a type checker. It is a net under the one hole that has
 * already cost a working feature.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

/** Everything the browser gives a script for free. */
const GLOBALS = new Set([
  'Object', 'Array', 'String', 'Number', 'Boolean', 'JSON', 'Math', 'Date', 'Promise', 'Set', 'Map', 'WeakMap',
  'WeakSet', 'RegExp', 'Error', 'TypeError', 'RangeError', 'URL', 'URLSearchParams', 'FormData', 'Blob', 'File',
  'FileReader', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'structuredClone', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'btoa', 'atob', 'fetch', 'crypto', 'navigator', 'document',
  'window', 'console', 'alert', 'confirm', 'prompt', 'Intl', 'TextDecoder', 'TextEncoder', 'AbortController',
  'Response', 'Headers', 'Request', 'Symbol', 'BigInt', 'Uint8Array', 'Uint16Array', 'Int32Array', 'Float64Array',
  'ArrayBuffer', 'DataView', 'performance', 'CSS', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent',
  'getComputedStyle', 'matchMedia', 'localStorage', 'sessionStorage', 'location', 'history', 'NodeList',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'customElements',
]);

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'function', 'await', 'else', 'do', 'try',
  'delete', 'void', 'in', 'of', 'instanceof', 'yield', 'throw', 'case', 'super', 'this', 'class', 'const', 'let',
  'var', 'async', 'true', 'false', 'null', 'undefined',
]);

type Token = { type: 'name' | 'punct'; value: string };

const isNameStart = (char: string): boolean => /[A-Za-z_$]/.test(char);
const isNamePart = (char: string): boolean => /[\w$]/.test(char);

/**
 * Just enough of a JavaScript tokeniser for this one question. Strings, template
 * literals, comments and regex literals are skipped, because a function name in a
 * sentence is not a function call.
 */
function tokenise(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let lastSignificant = '';

  const skipString = (quote: string): void => {
    index += 1;
    while (index < text.length) {
      const char = text[index];
      if (char === '\\') {
        index += 2;
        continue;
      }
      index += 1;
      if (char === quote) return;
      if (quote !== '`' && char === '\n') return; // an unterminated quote
    }
  };

  const skipTemplate = (): void => {
    index += 1;
    while (index < text.length) {
      const char = text[index];
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '`') {
        index += 1;
        return;
      }
      // `${ ... }` is code: tokenise it, because calls live in there.
      if (char === '$' && text[index + 1] === '{') {
        index += 2;
        let depth = 1;
        while (index < text.length && depth > 0) {
          const inner = text[index] ?? '';
          if (inner === '{') depth += 1;
          else if (inner === '}') depth -= 1;
          index += 1;
        }
        continue;
      }
      index += 1;
    }
  };

  const skipRegex = (): void => {
    index += 1;
    let inClass = false;
    while (index < text.length) {
      const char = text[index];
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) {
        index += 1;
        while (index < text.length && /[a-z]/i.test(text[index] ?? '')) index += 1;
        return;
      } else if (char === '\n') return;
      index += 1;
    }
  };

  while (index < text.length) {
    const char = text[index] ?? '';

    if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      skipString(char);
      lastSignificant = ')';
      continue;
    }
    if (char === '`') {
      skipTemplate();
      lastSignificant = ')';
      continue;
    }
    if (char === '/' && /[(,=:[!&|?{};+\-*%<>~^]/.test(lastSignificant) === true) {
      skipRegex();
      lastSignificant = ')';
      continue;
    }
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (isNameStart(char)) {
      let value = '';
      while (index < text.length && isNamePart(text[index] ?? '')) {
        value += text[index];
        index += 1;
      }
      tokens.push({ type: 'name', value });
      lastSignificant = value;
      continue;
    }
    tokens.push({ type: 'punct', value: char });
    lastSignificant = char;
    index += 1;
  }

  return tokens;
}

type Report = { declared: Set<string>; called: Set<string>; missing: string[] };

function analyse(text: string): Report {
  const tokens = tokenise(text);
  const declared = new Set<string>();
  const called = new Set<string>();

  const previous = (at: number): Token | undefined => tokens[at - 1];
  const isPunct = (token: Token | undefined, value: string): boolean =>
    token !== undefined && token.type === 'punct' && token.value === value;
  /** Keywords arrive as names, so they need their own comparison. */
  const isWord = (token: Token | undefined, value: string): boolean =>
    token !== undefined && token.type === 'name' && token.value === value;

  /** Identifiers inside a bracketed list, e.g. a parameter list or a destructuring. */
  const namesInside = (from: number): string[] => {
    const names: string[] = [];
    let depth = 0;
    for (let at = from; at < tokens.length; at += 1) {
      const token = tokens[at];
      if (token === undefined) break;
      if (token.type === 'name') {
        // `key: value` — only the value is a binding; `...rest` is a binding too.
        const next = tokens[at + 1];
        if (isPunct(next, ':')) continue;
        const before = previous(at);
        if (isPunct(before, '.') === true) continue;
        if (KEYWORDS.has(token.value)) continue;
        names.push(token.value);
        continue;
      }
      if (isPunct(token, '(') || isPunct(token, '{') || isPunct(token, '[')) depth += 1;
      else if (isPunct(token, ')') || isPunct(token, '}') || isPunct(token, ']')) {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return names;
  };

  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === undefined || token.type !== 'name') continue;
    const before = previous(at);
    const after = tokens[at + 1];

    // function foo(...), class Foo
    if (isWord(before, 'function') || isWord(before, 'class')) declared.add(token.value);

    // const/let/var foo = ..., and `const { a, b } = ...`
    if (isWord(before, 'const') || isWord(before, 'let') || isWord(before, 'var')) {
      if (isPunct(after, '{') || isPunct(after, '[')) {
        for (const name of namesInside(at + 1)) declared.add(name);
      } else {
        declared.add(token.value);
      }
    }

    // Parameters of a named or anonymous function: `function foo(a, b)`
    if (isPunct(after, '(') && isWord(before, 'function')) {
      for (const name of namesInside(at + 1)) declared.add(name);
    }
    // Parameters of an arrow function: `(a, b) => ...`, or `a => ...`
    if (isPunct(after, '=>')) declared.add(token.value);
    if (isPunct(before, '(') && isPunct(tokens[at + 2], ')') && isPunct(tokens[at + 3], '=>')) {
      declared.add(token.value);
    }
    // catch (error) — and `for (const x of ...)` is covered by const above
    if (isPunct(before, '(')) {
      const owner = previous(at - 1);
      if (isWord(owner, 'catch')) declared.add(token.value);
    }

    // A bare `name(` is a call to something that must exist in this file. Anything
    // after a dot is a method on an object, which is not this test's business.
    if (isPunct(after, '(') && !isPunct(before, '.') && !isWord(before, 'function')) {
      if (!KEYWORDS.has(token.value)) called.add(token.value);
    }
  }

  const missing = [...called].filter((name) => !declared.has(name) && !GLOBALS.has(name)).sort();
  return { declared, called, missing };
}

it('every function the interface calls is declared in it, or is a browser global', () => {
  const { missing } = analyse(source);
  assert.deepEqual(
    missing,
    [],
    `public/app.js calls ${missing.join(', ')} — not declared in the file and not a browser global. ` +
      'That is the shape of the bug that made the Back office button do nothing.',
  );
});

it('the scan actually found the code, so it is not passing by accident', () => {
  const { declared, called } = analyse(source);
  assert.ok(declared.size > 80, `only ${declared.size} declarations found — the scan has probably broken`);
  assert.ok(called.size > 80, `only ${called.size} calls found — the scan has probably broken`);
  for (const name of ['renderMain', 'api', 'loadWorkspace', 'renderAccessSection', 'renderHistory']) {
    assert.ok(declared.has(name), `${name} should be found as a declaration`);
  }
});

it('the net catches a function that is called but never written', () => {
  const report = analyse('function real() {}\nreal();\nghostFunction();\n');
  assert.deepEqual(report.missing, ['ghostFunction']);
});

it('a name inside a comment or a string is not a call', () => {
  const report = analyse(
    '// ghostOne()\nconst text = "ghostTwo()";\nconst template = `ghostThree()`;\nconst re = /ghostFour\\(/;\nfunction real() {}\nreal();\n',
  );
  assert.deepEqual(report.missing, []);
});
