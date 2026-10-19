/**
 * Template expansion.
 *
 * Templates are Markdown files containing `{{placeholders}}`. This module
 * turns a template + a bag of values into finished text. It is deliberately
 * small and predictable: an AI model decides *which values to use*, never
 * *what the document says*.
 *
 * Supported syntax
 *   {{field.key}}                 insert a value
 *   {{field.key|money}}           insert with a filter
 *   {{#if field.key}} … {{else}} … {{/if}}
 *   {{#each tenants}} … {{this.full_name}} … {{/each}}
 *
 * Filters: money, date, dateshort, dateordinal, upper, lower, title, number
 */

export type Scope = Record<string, unknown>;

export type ExpandOptions = {
  /** Value used when a placeholder resolves to nothing. */
  missing?: string;
  /** Called for each placeholder that had no value — lets callers report gaps. */
  onMissing?: (key: string) => void;
};

type Node =
  | { kind: 'text'; value: string }
  | { kind: 'var'; expr: string }
  | { kind: 'if'; expr: string; then: Node[]; otherwise: Node[] }
  | { kind: 'each'; expr: string; body: Node[] };

const TOKEN = /\{\{([\s\S]*?)\}\}/g;

/** Split raw text into interleaved literal text and `{{ }}` expressions. */
function tokenize(text: string): Array<{ raw: string; expr: string | null }> {
  const out: Array<{ raw: string; expr: string | null }> = [];
  let last = 0;
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null = TOKEN.exec(text);
  while (match !== null) {
    if (match.index > last) out.push({ raw: text.slice(last, match.index), expr: null });
    out.push({ raw: match[0], expr: (match[1] ?? '').trim() });
    last = match.index + match[0].length;
    match = TOKEN.exec(text);
  }
  if (last < text.length) out.push({ raw: text.slice(last), expr: null });
  return out;
}

/** Build a tree so that #if / #each blocks can wrap other blocks. */
function build(tokens: ReturnType<typeof tokenize>, where = 'template'): Node[] {
  const root: Node[] = [];
  // One entry per open block: its node plus which branch we are filling.
  const stack: Array<{ node: Node; target: Node[] }> = [];
  let target = root;

  for (const token of tokens) {
    if (token.expr === null) {
      target.push({ kind: 'text', value: token.raw });
      continue;
    }
    const expr = token.expr;

    if (expr.startsWith('#if ')) {
      const node: Node = { kind: 'if', expr: expr.slice(4).trim(), then: [], otherwise: [] };
      target.push(node);
      stack.push({ node, target });
      target = node.then;
    } else if (expr.startsWith('#each ')) {
      const node: Node = { kind: 'each', expr: expr.slice(6).trim(), body: [] };
      target.push(node);
      stack.push({ node, target });
      target = node.body;
    } else if (expr === 'else') {
      const top = stack[stack.length - 1];
      if (!top || top.node.kind !== 'if') {
        throw new Error(`${where}: {{else}} without a matching {{#if}}`);
      }
      target = top.node.otherwise;
    } else if (expr.startsWith('/')) {
      const top = stack.pop();
      if (!top) throw new Error(`${where}: unexpected closing tag {{${expr}}}`);
      const expected = top.node.kind === 'if' ? '/if' : '/each';
      if (expr !== expected) {
        throw new Error(`${where}: {{${expr}}} does not match open {{#${top.node.kind}}}`);
      }
      target = stack[stack.length - 1]?.target ?? root;
    } else {
      target.push({ kind: 'var', expr });
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    throw new Error(`${where}: unclosed {{#${unclosed?.node.kind}}} block`);
  }
  return root;
}

function isPlainObject(value: unknown): value is Scope {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolve a value path against the scope stack.
 *
 * Field keys are usually *flat* strings that merely look nested — a pack stores
 * `"landlord.full_name": "Priya Raman"`, not `{landlord: {full_name}}`. So an
 * exact key match is tried first, and only then do we walk a real object path
 * (which is what `{{this.full_name}}` needs inside an `{{#each}}`).
 */
function resolve(path: string, scopes: Scope[]): unknown {
  const trimmed = path.trim();
  if (trimmed === '') return undefined;

  for (const scope of scopes) {
    if (Object.hasOwn(scope, trimmed)) return scope[trimmed];
  }

  const parts = trimmed.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;

  const [head, ...rest] = parts as [string, ...string[]];

  if (head === 'this') {
    const current = scopes[0];
    if (current === undefined) return undefined;
    if (rest.length === 0) return current;
    return walk(current, rest);
  }

  for (const scope of scopes) {
    if (Object.hasOwn(scope, head)) {
      const found = scope[head];
      return rest.length === 0 ? found : walk(found, rest);
    }
  }
  return undefined;
}

function walk(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isPlainObject(current)) return undefined;
    if (!Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** A value reduced to the string used in comparisons. */
function compareString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return String(value).trim().toLowerCase();
}

/**
 * Parse an `#if` expression.
 *
 *   {{#if deposit}}            present and not empty
 *   {{#if !deposit}}           inverted
 *   {{#if pets_allowed == "Yes"}}
 *   {{#if pets_allowed != "No"}}
 *
 * Comparisons exist because select fields hold words, not booleans — "No" is a
 * perfectly truthy string, which is exactly the kind of quiet mistake that
 * should not reach a signed tenancy agreement.
 */
export type Condition = {
  negate: boolean;
  path: string;
  compare?: { op: '==' | '!='; value: string };
};

export function parseCondition(expr: string): Condition {
  let text = expr.trim();
  let negate = false;
  if (text.startsWith('!')) {
    negate = true;
    text = text.slice(1).trim();
  }

  const comparison = /^([^=!]+?)\s*(==|!=)\s*(.+)$/.exec(text);
  if (comparison) {
    return {
      negate,
      path: (comparison[1] ?? '').trim(),
      compare: { op: (comparison[2] ?? '==') as '==' | '!=', value: unquote((comparison[3] ?? '').trim()) },
    };
  }
  return { negate, path: text };
}

function evaluateCondition(expr: string, scopes: Scope[]): boolean {
  const condition = parseCondition(expr);

  let result: boolean;
  if (condition.compare !== undefined) {
    const left = compareString(resolve(condition.path, scopes));
    const right = compareString(condition.compare.value);
    const equal = left === right;
    result = condition.compare.op === '==' ? equal : !equal;
  } else {
    result = truthy(resolve(condition.path, scopes));
  }

  return condition.negate ? !result : result;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Parse the date shapes that turn up in letting paperwork. */
export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    const [, y, m, d] = iso as unknown as [string, string, string, string];
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (uk) {
    const [, d, m, y] = uk as unknown as [string, string, string, string];
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function formatMoney(value: unknown): string {
  const numeric = toNumber(value);
  if (numeric === null) return '';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: numeric % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[£,\s]/g, '');
  if (cleaned === '') return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatDate(value: unknown, style: 'long' | 'ordinal' | 'short'): string {
  const date = parseDate(value);
  if (date === null) return '';
  const day = date.getDate();
  const month = MONTHS[date.getMonth()] ?? '';
  const year = date.getFullYear();
  if (style === 'short') {
    return `${String(day).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${year}`;
  }
  if (style === 'ordinal') return `${ordinal(day)} ${month} ${year}`;
  return `${day} ${month} ${year}`;
}

function applyFilter(value: unknown, filter: string): string {
  switch (filter) {
    case 'money': return formatMoney(value);
    case 'date': return formatDate(value, 'long');
    case 'dateordinal': return formatDate(value, 'ordinal');
    case 'dateshort': return formatDate(value, 'short');
    case 'upper': return String(value ?? '').toUpperCase();
    case 'lower': return String(value ?? '').toLowerCase();
    case 'title': return toDisplayString(value).replace(/\b\w/g, (c) => c.toUpperCase());
    case 'number': {
      const numeric = toNumber(value);
      return numeric === null ? '' : String(numeric);
    }
    default:
      throw new Error(`Unknown filter "${filter}" in template`);
  }
}

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return formatDate(value, 'long');
  return '';
}

function evaluate(expr: string, scopes: Scope[]): string {
  const [rawPath, ...filters] = expr.split('|').map((part) => part.trim());
  if (!rawPath) return '';
  let value = resolve(rawPath, scopes);
  for (const filter of filters) {
    if (filter) value = applyFilter(value, filter);
  }
  return toDisplayString(value);
}

function renderNodes(nodes: Node[], scopes: Scope[], options: ExpandOptions): string {
  let out = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out += node.value;
        break;
      case 'var': {
        const path = node.expr.split('|')[0]?.trim() ?? '';
        const value = resolve(path, scopes);
        if (!truthy(value)) options.onMissing?.(path);
        out += evaluate(node.expr, scopes);
        break;
      }
      case 'if': {
        const branch = evaluateCondition(node.expr, scopes) ? node.then : node.otherwise;
        out += renderNodes(branch, scopes, options);
        break;
      }
      case 'each': {
        const collection = resolve(node.expr, scopes);
        if (Array.isArray(collection)) {
          for (const item of collection) {
            out += renderNodes(node.body, [isPlainObject(item) ? item : { this: item }, ...scopes], options);
          }
        }
        break;
      }
    }
  }
  return out;
}

/** Expand a template body with the given values. */
export function expand(template: string, values: Scope, options: ExpandOptions = {}): string {
  const nodes = build(tokenize(template));
  return renderNodes(nodes, [values], options);
}

/**
 * Every value path referenced by a template, in first-seen order.
 * Used to tell the user which details a document needs.
 */
export function placeholdersIn(template: string): string[] {
  const seen = new Set<string>();
  const add = (expr: string) => {
    const path = expr.split('|')[0]?.trim() ?? '';
    if (path === '' || path === 'this' || path.startsWith('this.')) return;
    seen.add(path);
  };

  const walkNodes = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.kind === 'var') add(node.expr);
      else if (node.kind === 'if') {
        add(parseCondition(node.expr).path);
        walkNodes(node.then);
        walkNodes(node.otherwise);
      } else if (node.kind === 'each') {
        add(node.expr);
        walkNodes(node.body);
      }
    }
  };

  walkNodes(build(tokenize(template)));
  return [...seen];
}

/** Split `${'---'}` front matter from a template file. */
export function splitFrontMatter(source: string): { meta: string; body: string } {
  const normalised = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalised.startsWith('---\n')) {
    return { meta: '', body: normalised };
  }
  const end = normalised.indexOf('\n---', 3);
  if (end === -1) return { meta: '', body: normalised };
  const meta = normalised.slice(4, end);
  const rest = normalised.slice(end + 4);
  return { meta, body: rest.replace(/^\n/, '') };
}

/**
 * Minimal YAML reader for the flat front matter we use:
 * `key: value`, inline arrays `[a, b]`, and quoted strings.
 * A full YAML parser would be overkill here.
 */
export function parseFrontMatter(meta: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const line of meta.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      out[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => unquote(item.trim()))
        .filter((item) => item !== '');
    } else {
      out[key] = unquote(value);
    }
  }
  return out;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
    (value.startsWith("'") && value.endsWith("'") && value.length > 1)
  ) {
    return value.slice(1, -1);
  }
  return value;
}
