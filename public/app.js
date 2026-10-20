/* ==========================================================================
   TenancyDesk — browser application
   Plain JavaScript, no build step, no framework. Everything the letting agent
   sees is rendered from the API described in docs/API.md.
   ========================================================================== */

'use strict';

/* ---------------------------------------------------------------- state --- */

const state = {
  config: null,
  groups: [],
  fields: [],
  templates: [],
  packs: [],
  activeId: null,
  detail: null,
  tab: 'assistant',
  /** 'tenancy' shows one pack; 'backoffice' shows the agency's records. */
  view: 'tenancy',
  boTab: 'settings',
  backOffice: null,
  /** Fields the user has actually typed, so inherited values are not frozen. */
  dirty: new Set(),
  selection: new Set(),
  chat: new Map(), // packId -> [{ role, text, trace }]
  streaming: false,
  saveTimer: null,
};

const CHIPS = [
  { label: 'What is still missing?', message: 'What is still missing from this pack? Ask me for anything you need.' },
  { label: 'Run the checks', message: 'Run the compliance checks and tell me if anything needs fixing.' },
  { label: 'Generate the pack', message: 'Generate every document this tenant needs for move-in.' },
  { label: 'Draft the tenant email', message: 'Draft the covering email and a short WhatsApp message for the tenant.' },
];

/* -------------------------------------------------------------- helpers --- */

const $ = (selector, root = document) => root.querySelector(selector);

/**
 * Tiny element builder.
 * el('div', { class: 'x', onClick: fn }, child, 'text')
 */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMoney(value) {
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[£,\s]/g, ''));
  if (!Number.isFinite(numeric)) return String(value ?? '');
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(numeric);
}

function daysUntil(iso) {
  const target = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function toast(message, isError = false) {
  const node = el('div', { class: `toast${isError ? ' is-err' : ''}` }, message);
  $('#toast-root').append(node);
  setTimeout(() => node.remove(), isError ? 6000 : 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    throw new Error((data && data.error) || `Request failed (${response.status})`);
  }
  return data;
}

/* ------------------------------------------------------------- lifecycle --- */

async function boot() {
  try {
    const [config, fields, templates, packs] = await Promise.all([
      api('/api/config'),
      api('/api/fields'),
      api('/api/templates'),
      api('/api/packs'),
    ]);
    state.config = config;
    state.groups = fields.groups;
    state.fields = fields.fields;
    state.templates = templates.templates;
    state.packs = packs.packs;

    renderStatus();
    renderSidebar();

    if (state.packs.length > 0) {
      await selectPack(state.packs[0].id, { keepTab: false });
    } else {
      renderMain();
    }
  } catch (error) {
    $('#main').replaceChildren(
      el('div', { class: 'notice notice-err' }, `TenancyDesk could not load: ${error.message}`),
    );
  }
}

function renderStatus() {
  const pill = $('#status-pill');
  const available = state.config.assistantAvailable;
  pill.className = `pill ${available ? 'is-on' : 'is-off'}`;
  pill.textContent = available ? `Assistant ready · ${state.config.model}` : 'Assistant off';
  pill.title = available
    ? 'The DeepSeek assistant is connected.'
    : state.config.offlineMode
      ? 'The assistant is switched off (OFFLINE_MODE). Everything else still works.'
      : 'No DeepSeek API key. Add DEEPSEEK_API_KEY to .env — see docs/DEEPSEEK.md';

  if (state.config.templateWarnings && state.config.templateWarnings.length > 0) {
    pill.textContent += ' · template warning';
  }
}

/* --------------------------------------------------------------- sidebar --- */

function renderSidebar() {
  const list = $('#pack-list');
  $('#pack-count').textContent = String(state.packs.length);
  $('#sidebar-empty').hidden = state.packs.length > 0;

  list.replaceChildren(
    ...state.packs.map((pack) => {
      const meta = [];
      if (pack.errorCount > 0) meta.push(el('span', { class: 'badge badge-err' }, `${pack.errorCount} to fix`));
      else if (pack.ready) meta.push(el('span', { class: 'badge badge-ok' }, 'Complete'));
      else meta.push(el('span', { class: 'badge badge-warn' }, 'Incomplete'));

      if (pack.documentCount > 0) {
        meta.push(el('span', { class: 'badge' }, `${pack.documentCount} doc${pack.documentCount === 1 ? '' : 's'}`));
      }

      return el(
        'li',
        {
          class: `pack-item${pack.id === state.activeId ? ' is-active' : ''}`,
          tabindex: '0',
          role: 'button',
          onClick: () => selectPack(pack.id),
          onKeydown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              selectPack(pack.id);
            }
          },
        },
        el('span', { class: 'pack-name' }, pack.tenantName || 'Unnamed tenant'),
        el('span', { class: 'pack-sub' }, pack.propertyAddress || pack.reference),
        el('div', { class: 'pack-meta' }, ...meta),
      );
    }),
  );
}

async function refreshPacks() {
  const data = await api('/api/packs');
  state.packs = data.packs;
  renderSidebar();
}

/* ------------------------------------------------------------ pack select --- */

async function selectPack(id, options = {}) {
  state.activeId = id;
  state.selection = new Set();
  try {
    state.detail = await api(`/api/packs/${id}`);
  } catch (error) {
    toast(error.message, true);
    await refreshPacks();
    return;
  }
  if (options.keepTab !== true) state.tab = 'assistant';
  if (!state.chat.has(id)) state.chat.set(id, []);
  renderSidebar();
  renderMain();
}

async function reloadDetail() {
  if (state.activeId === null) return;
  state.detail = await api(`/api/packs/${state.activeId}`);
  await refreshPacks();
}

async function createPack() {
  try {
    const created = await api('/api/packs', { method: 'POST', body: JSON.stringify({ fields: {} }) });
    state.detail = created;
    state.activeId = created.pack.id;
    state.chat.set(created.pack.id, []);
    state.tab = 'details';
    await refreshPacks();
    renderMain();
    toast('New pack created. Add the tenant details, or paste an email to the assistant.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function deletePack() {
  if (state.detail === null) return;
  const name = state.detail.pack.tenantName || state.detail.pack.reference;
  if (!window.confirm(`Delete the pack for ${name}? The generated documents are removed too. This cannot be undone.`)) {
    return;
  }
  try {
    await api(`/api/packs/${state.activeId}`, { method: 'DELETE' });
    state.activeId = null;
    state.detail = null;
    await refreshPacks();
    if (state.packs.length > 0) await selectPack(state.packs[0].id);
    else renderMain();
    toast('Pack deleted.');
  } catch (error) {
    toast(error.message, true);
  }
}

/* ------------------------------------------------------------------ main --- */

function renderMain() {
  const main = $('#main');

  if (state.view === 'backoffice') {
    renderBackOffice(main);
    return;
  }

  if (state.detail === null) {
    main.replaceChildren(
      el(
        'div',
        { class: 'empty-state' },
        el('h2', {}, 'Tenancy paperwork, without the typing'),
        el(
          'p',
          {},
          'TenancyDesk fills your own tenancy templates with each new tenant’s details, checks them against the rules, and hands you the finished documents.',
        ),
        el(
          'div',
          { class: 'steps' },
          step('1', 'Create a pack', 'One pack per tenancy. Paste the landlord’s email, or type the details in yourself.'),
          step('2', 'Let the assistant do the reading', 'It pulls out names, dates and amounts — and asks you about anything it cannot find.'),
          step('3', 'Check, then download', 'Review the compliance checks, then download Word files or print them to PDF.'),
        ),
        el('button', { class: 'btn btn-primary', type: 'button', onClick: createPack }, 'Create your first pack'),
      ),
    );
    return;
  }

  const { pack, readiness, documents } = state.detail;
  const title = pack.tenantName || 'Unnamed tenant';
  const errorCount = readiness.compliance.counts.error;

  const tabs = [
    ['assistant', 'Assistant', null],
    ['details', 'Details', null],
    ['documents', 'Documents', documents.length > 0 ? documents.length : null],
    ['checks', 'Checks', errorCount > 0 ? errorCount : null],
  ];

  main.replaceChildren(
    el(
      'div',
      { class: 'pack-head' },
      el(
        'div',
        { class: 'pack-title' },
        el('h2', {}, title),
        el('div', { class: 'pack-where' }, pack.propertyAddress || 'No property address yet'),
        el(
          'div',
          { class: 'pack-meta', style: { marginTop: '.45rem' } },
          el('span', { class: 'badge' }, pack.reference),
          errorCount > 0
            ? el('span', { class: 'badge badge-err' }, `${errorCount} to fix`)
            : el('span', { class: 'badge badge-ok' }, 'Checks passed'),
          el('span', { class: 'badge' }, `${documents.length} document${documents.length === 1 ? '' : 's'}`),
        ),
      ),
      el(
        'div',
        { class: 'pack-actions' },
        documents.length > 0
          ? el(
              'button',
              {
                class: 'btn btn-primary',
                type: 'button',
                onClick: () => {
                  window.location.href = `/api/packs/${pack.id}/bundle.zip`;
                },
              },
              'Download all (ZIP)',
            )
          : null,
        el('button', { class: 'btn btn-danger btn-sm', type: 'button', onClick: deletePack }, 'Delete'),
      ),
    ),
    el(
      'div',
      { class: 'tabs', role: 'tablist' },
      ...tabs.map(([id, label, count]) =>
        el(
          'button',
          {
            class: `tab${state.tab === id ? ' is-active' : ''}`,
            type: 'button',
            role: 'tab',
            'aria-selected': state.tab === id ? 'true' : 'false',
            onClick: () => {
              state.tab = id;
              if (id === 'documents' && state.selection.size === 0) {
                state.selection = new Set(state.detail.suggested);
              }
              renderMain();
            },
          },
          label,
          count === null ? null : el('span', { class: 'tab-count' }, String(count)),
        ),
      ),
    ),
    tabContent(),
  );
}

function step(number, title, text) {
  return el(
    'div',
    { class: 'step' },
    el('div', { class: 'step-num' }, number),
    el('div', {}, el('h3', {}, title), el('p', {}, text)),
  );
}

function tabContent() {
  switch (state.tab) {
    case 'details': return renderDetails();
    case 'documents': return renderDocuments();
    case 'checks': return renderChecks();
    default: return renderAssistant();
  }
}

/* ------------------------------------------------------------- assistant --- */

function renderAssistant() {
  const packId = state.detail.pack.id;
  const messages = state.chat.get(packId) || [];
  const log = el('div', { class: 'chat-log', id: 'chat-log' });

  if (messages.length === 0) {
    log.append(
      el(
        'div',
        { class: 'msg' },
        el('div', { class: 'msg-avatar' }, 'TD'),
        el(
          'div',
          { class: 'msg-bubble' },
          el('p', {}, 'Hello. I can turn your templates into this tenant’s documents.'),
          el(
            'p',
            { style: { marginBottom: '0' } },
            'Paste the landlord’s email or your WhatsApp thread into the box below and I will pull out the details — or use one of the shortcuts.',
          ),
        ),
      ),
    );
  }

  for (const message of messages) {
    // Never render an empty bubble: a stream that produced no text (or a turn
    // still in flight) should leave nothing behind in the transcript.
    const text = String(message.text ?? '').trim();
    const hasTrace = Array.isArray(message.trace) && message.trace.length > 0;
    if (text === '' && !(message.role !== 'user' && hasTrace)) continue;

    if (message.role === 'user') {
      log.append(
        el(
          'div',
          { class: 'msg msg-user' },
          el('div', { class: 'msg-avatar' }, 'You'),
          el('div', { class: 'msg-bubble' }, ...renderMessageText(message.text)),
        ),
      );
      continue;
    }

    const trace = message.trace && message.trace.length > 0
      ? el(
          'div',
          { class: 'trace' },
          el('h4', {}, 'What I did'),
          ...message.trace.map((entry) =>
            el(
              'div',
              { class: `trace-step${entry.ok === false ? ' is-err' : ''}` },
              el('span', { class: 'dot' }),
              el('span', {}, entry.label),
              el('span', { class: 'trace-detail' }, entry.detail ? ` — ${entry.detail}` : ''),
            ),
          ),
        )
      : null;

    log.append(
      el(
        'div',
        { class: 'msg' },
        el('div', { class: 'msg-avatar' }, 'TD'),
        el(
          'div',
          { style: { display: 'grid', gap: '.5rem' } },
          trace,
          el('div', { class: 'msg-bubble' }, ...renderMessageText(message.text)),
        ),
      ),
    );
  }

  if (state.streaming) {
    log.append(el('div', { class: 'thinking' }, el('span'), el('span'), el('span'), ' working…'));
  }

  const textarea = el('textarea', {
    placeholder: 'Paste an email, or ask for something… (Enter to send, Shift+Enter for a new line)',
    id: 'composer-input',
  });

  const send = async () => {
    const text = textarea.value.trim();
    if (text === '' || state.streaming) return;
    textarea.value = '';
    await sendMessage(text);
  };

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  });

  const available = state.config.assistantAvailable;

  const composer = el(
    'div',
    { class: 'composer' },
    el(
      'div',
      { class: 'chips' },
      ...CHIPS.map((chip) =>
        el(
          'button',
          {
            class: 'chip',
            type: 'button',
            disabled: !available || state.streaming,
            onClick: () => {
              void sendMessage(chip.message);
            },
          },
          chip.label,
        ),
      ),
    ),
    textarea,
    el(
      'div',
      { class: 'composer-row' },
      el('span', { class: 'composer-hint' }, available ? 'The assistant can fill in details, check the rules and generate documents.' : 'The assistant needs a DeepSeek API key — see docs/DEEPSEEK.md.'),
      el(
        'button',
        { class: 'btn btn-primary', type: 'button', disabled: !available || state.streaming, onClick: send },
        state.streaming ? 'Working…' : 'Send',
      ),
    ),
  );

  const notice = available
    ? null
    : el(
        'div',
        { class: 'notice notice-warn' },
        state.config.offlineMode
          ? 'The assistant is switched off, but everything else works: fill in the Details tab and generate documents from the Documents tab.'
          : 'No DeepSeek API key found, so the assistant cannot answer. Add DEEPSEEK_API_KEY to your .env file and restart. Meanwhile you can fill in the Details tab by hand.',
      );

  const content = el('div', { class: 'assistant' }, notice, log, composer);
  requestAnimationFrame(() => {
    const logNow = $('#chat-log');
    if (logNow) logNow.scrollTop = logNow.scrollHeight;
  });
  return content;
}

function renderMessageText(text) {
  const nodes = [];
  const blocks = String(text).split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;
    const bulleted = lines.every((line) => /^[-*•]\s+/.test(line.trim()));
    if (bulleted) {
      nodes.push(el('ul', {}, ...lines.map((line) => el('li', {}, line.replace(/^[-*•]\s+/, '')))));
    } else if (lines.every((line) => /^\d+[.)]\s+/.test(line.trim()))) {
      nodes.push(el('ol', {}, ...lines.map((line) => el('li', {}, line.replace(/^\d+[.)]\s+/, '')))));
    } else {
      nodes.push(el('p', {}, lines.join(' ')));
    }
  }
  if (nodes.length === 0) nodes.push(el('p', {}, String(text)));
  return nodes;
}

async function sendMessage(text) {
  const packId = state.detail.pack.id;
  if (!state.chat.has(packId)) state.chat.set(packId, []);
  const messages = state.chat.get(packId);

  messages.push({ role: 'user', text });
  const reply = { role: 'assistant', text: '', trace: [] };
  const replyIndex = messages.push(reply) - 1;

  state.streaming = true;
  renderMain();

  try {
    const response = await fetch(`/api/packs/${packId}/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `The assistant could not be reached (${response.status}).`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        const line = chunk.split('\n').find((part) => part.startsWith('data: '));
        if (line === undefined) continue;

        let event;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        handleAgentEvent(event, messages[replyIndex], () => {
          renderMain();
          const logNow = $('#chat-log');
          if (logNow) logNow.scrollTop = logNow.scrollHeight;
        });
      }
    }

    if (messages[replyIndex] && messages[replyIndex].text === '') {
      messages[replyIndex].text = 'Done — check the Documents tab to see what changed.';
    }
  } catch (error) {
    messages[replyIndex].text = `Sorry — ${error.message}`;
  } finally {
    state.streaming = false;
    await reloadDetail();
    renderMain();
  }
}

function handleAgentEvent(event, reply, rerender) {
  if (reply === undefined) return;

  switch (event.type) {
    case 'tool':
      reply.trace.push({ label: event.detail, detail: '', ok: true });
      rerender();
      break;

    case 'tool_result': {
      const last = reply.trace[reply.trace.length - 1];
      if (last !== undefined) {
        last.ok = event.ok;
        last.detail = event.summary;
      }
      rerender();
      break;
    }

    case 'message':
      reply.text = event.text;
      rerender();
      break;

    case 'error':
    case 'fatal':
      reply.text = reply.text === '' ? event.message : `${reply.text}\n\n${event.message}`;
      rerender();
      break;

    default:
      break;
  }
}

/* --------------------------------------------------------------- details --- */

function renderDetails() {
  const { pack, readiness } = state.detail;
  // The merged view: the tenancy's own values over what it inherits.
  const values = state.detail.fields ?? pack.fields;
  const provenance = state.detail.provenance ?? {};
  const byGroup = new Map(state.groups.map((group) => [group.id, []]));
  for (const field of state.fields) {
    if (byGroup.has(field.group)) byGroup.get(field.group).push(field);
  }

  const filled = state.fields.filter((field) => {
    if (field.type === 'people') {
      const people = values[field.key];
      return Array.isArray(people) && people.some((person) => person && person.full_name);
    }
    const value = values[field.key];
    return value !== undefined && value !== null && String(value).trim() !== '';
  }).length;

  const inheritedCount = state.fields.filter((field) => {
    const source = provenance[field.key];
    return source !== undefined && source !== 'tenancy' && source !== 'derived';
  }).length;

  const progress = el(
    'div',
    { class: 'progress', id: 'form-progress' },
    el('strong', {}, `${filled} of ${state.fields.length}`),
    ' details filled in' +
      (readiness.missingCore.length > 0
        ? ` · ${readiness.missingCore.length} essential${readiness.missingCore.length === 1 ? '' : 's'} still missing`
        : ' · everything essential is here') +
      (inheritedCount > 0 ? ` · ${inheritedCount} pre-filled for you` : ''),
  );

  const sections = state.groups
    .map((group) => {
      const fields = byGroup.get(group.id);
      if (fields === undefined || fields.length === 0) return null;
      const open = ['tenants', 'property', 'tenancy'].includes(group.id) || fields.some((field) => isMissing(values, field));
      return el(
        'details',
        { class: 'form-section', open: open },
        el(
          'summary',
          {},
          el('span', {}, group.title),
          el('span', { class: 'section-blurb' }, group.blurb),
        ),
        el('div', { class: 'form-body' }, ...fields.map((field) => renderField(field, values, provenance))),
      );
    })
    .filter(Boolean);

  const save = el(
    'button',
    { class: 'btn btn-primary', type: 'button', onClick: () => saveFields(true) },
    'Save details',
  );

  return el(
    'div',
    {},
    Object.keys(pack.fields ?? {}).length === 0
      ? el(
          'div',
          { class: 'notice notice-info' },
          'Nothing entered yet. You can paste the landlord’s email to the Assistant, or fill this in by hand — either way is fine.',
        )
      : null,
    ...sections,
    el('div', { class: 'form-actions' }, progress, save),
  );
}

function isMissing(values, field) {
  if (field.type === 'people') {
    const people = values[field.key];
    return !(Array.isArray(people) && people.some((person) => person && person.full_name));
  }
  const value = values[field.key];
  return value === undefined || value === null || String(value).trim() === '';
}

/** A badge saying where a pre-filled value came from. */
function provenanceBadge(source) {
  if (source === undefined || source === 'tenancy' || source === 'derived') return null;
  const wording = {
    room: 'from the room',
    property: 'from the property',
    landlord: 'from the landlord',
    agency: 'from your agency',
  };
  return el('span', { class: `prov prov-${source}` }, wording[source] ?? source);
}

function renderField(field, values, provenance) {
  if (field.type === 'people') return renderPeopleField(field, values);

  const value = values[field.key] ?? '';
  const missing = field.core === true && isMissing(values, field);
  const source = provenance[field.key];
  const inherited = source !== undefined && source !== 'tenancy' && source !== 'derived';

  // Only fields the user actually types are sent when saving, so a prefilled
  // value is never written down and frozen into this tenancy.
  const track = () => {
    state.dirty.add(field.key);
    queueSave();
  };

  const common = {
    id: `field-${field.key}`,
    'data-field': field.key,
    onInput: track,
    onChange: track,
  };

  const label = el(
    'label',
    { for: `field-${field.key}` },
    field.label,
    field.core === true ? el('span', { class: 'is-missing' }, ' *') : null,
    provenanceBadge(source),
  );

  let input;

  if (field.type === 'select') {
    input = el(
      'select',
      common,
      el('option', { value: '' }, '— choose —'),
      ...(field.options || []).map((option) =>
        el('option', { value: option, selected: String(value) === option }, option),
      ),
    );
  } else if (field.type === 'textarea') {
    input = el('textarea', common);
    input.value = String(value);
  } else if (field.type === 'date') {
    input = el('input', { ...common, type: 'date', value: String(value) });
  } else if (field.type === 'number') {
    input = el('input', { ...common, type: 'number', value: String(value) });
  } else if (field.type === 'money') {
    const inner = el('input', { ...common, type: 'text', inputmode: 'decimal', value: String(value) });
    if (inherited) inner.classList.add('is-inherited');
    return el(
      'div',
      { class: 'field' },
      label,
      el('div', { class: 'money-input' }, el('span', { class: 'prefix' }, '£'), inner),
      field.help ? el('span', { class: 'help' }, field.help) : null,
    );
  } else {
    input = el('input', { ...common, type: 'text', value: String(value), placeholder: field.placeholder || '' });
  }

  if (missing) input.classList.add('is-required-empty');
  if (inherited) input.classList.add('is-inherited');

  return el(
    'div',
    { class: 'field' },
    label,
    input,
    field.help ? el('span', { class: 'help' }, field.help) : null,
  );
}

function renderPeopleField(field, values) {
  const people = Array.isArray(values[field.key]) ? values[field.key] : [];
  const container = el('div', { 'data-people': field.key });

  // Editing a tenant is an explicit change, so the list becomes this tenancy's own.
  const markPeopleDirty = () => {
    state.dirty.add(field.key);
    queueSave();
  };

  const addPerson = (person = {}) => {
    const index = container.querySelectorAll('.person-card').length;
    const card = el(
      'div',
      { class: 'person-card' },
      el(
        'div',
        { class: 'person-head' },
        el('strong', {}, `Tenant ${index + 1}`),
        el(
          'button',
          {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            onClick: () => {
              card.remove();
              renumber();
              markPeopleDirty();
            },
          },
          'Remove',
        ),
      ),
      el(
        'div',
        { class: 'grid-2' },
        ...(field.children || []).map((child) =>
          el(
            'div',
            { class: 'field' },
            el('label', {}, child.label),
            child.type === 'textarea'
              ? el('textarea', { 'data-person-key': child.key, onInput: markPeopleDirty }, person[child.key] ?? '')
              : el('input', {
                  type: child.type === 'date' ? 'date' : 'text',
                  'data-person-key': child.key,
                  value: person[child.key] ?? '',
                  placeholder: child.placeholder || '',
                  onInput: markPeopleDirty,
                }),
          ),
        ),
      ),
    );
    container.append(card);
    renumber();
  };

  const renumber = () => {
    container.querySelectorAll('.person-card strong').forEach((strong, index) => {
      strong.textContent = `Tenant ${index + 1}`;
    });
  };

  if (people.length === 0) addPerson();
  else for (const person of people) addPerson(person);

  return el(
    'div',
    { class: 'field' },
    el('label', {}, field.label, field.core === true ? el('span', { class: 'is-missing' }, ' *') : null),
    field.help ? el('span', { class: 'help' }, field.help) : null,
    container,
    el(
      'button',
      {
        class: 'btn btn-sm',
        type: 'button',
        style: { marginTop: '.6rem' },
        onClick: () => {
          addPerson();
          markPeopleDirty();
        },
      },
      'Add another tenant',
    ),
  );
}

function collectFields() {
  const fields = {};

  // Only what the user has actually typed. Anything else shown in the form is an
  // inherited value, and writing it down would freeze it into this tenancy.
  document.querySelectorAll('[data-field]').forEach((input) => {
    const key = input.dataset.field;
    if (!state.dirty.has(key)) return;
    fields[key] = input.value;
  });

  document.querySelectorAll('[data-people]').forEach((container) => {
    const key = container.dataset.people;
    if (!state.dirty.has(key)) return;
    const people = [...container.querySelectorAll('.person-card')]
      .map((card) => {
        const person = {};
        card.querySelectorAll('[data-person-key]').forEach((input) => {
          if (input.value.trim() !== '') person[input.dataset.personKey] = input.value;
        });
        return person;
      })
      .filter((person) => Object.keys(person).length > 0);
    fields[key] = people;
  });

  return fields;
}

function queueSave() {
  if (state.saveTimer !== null) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    void saveFields(false);
  }, 900);
}

async function saveFields(announce) {
  if (state.activeId === null) return;
  const saveButtons = document.querySelectorAll('.form-actions .btn-primary');
  saveButtons.forEach((button) => {
    button.disabled = true;
  });

  try {
    const fields = collectFields();
    const updated = await api(`/api/packs/${state.activeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    });
    state.detail = updated;
    state.dirty.clear();

    const progress = $('#form-progress');
    if (progress !== null) {
      const readiness = updated.readiness;
      const filled = state.fields.filter((field) => {
        if (field.type === 'people') {
          const people = (updated.fields ?? updated.pack.fields)[field.key];
          return Array.isArray(people) && people.some((person) => person && person.full_name);
        }
        const value = (updated.fields ?? updated.pack.fields)[field.key];
        return value !== undefined && value !== null && String(value).trim() !== '';
      }).length;
      progress.replaceChildren(
        el('strong', {}, `${filled} of ${state.fields.length}`),
        ' details filled in' +
          (readiness.missingCore.length > 0
            ? ` · ${readiness.missingCore.length} essential${readiness.missingCore.length === 1 ? '' : 's'} still missing`
            : ' · everything essential is here'),
      );
    }

    await refreshPacks();
    if (announce) toast('Details saved.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    saveButtons.forEach((button) => {
      button.disabled = false;
    });
  }
}

/* ------------------------------------------------------------- documents --- */

function renderDocuments() {
  const { pack, templates, documents, suggested } = state.detail;

  if (state.selection.size === 0) state.selection = new Set(suggested);

  const cards = templates.map((template) => {
    const selected = state.selection.has(template.id);
    const checkbox = el('input', {
      type: 'checkbox',
      checked: selected,
      onChange: (event) => {
        if (event.target.checked) state.selection.add(template.id);
        else state.selection.delete(template.id);
        event.target.closest('.doc-card').classList.toggle('is-selected', event.target.checked);
      },
    });

    return el(
      'div',
      { class: `doc-card${selected ? ' is-selected' : ''}` },
      checkbox,
      el(
        'div',
        { class: 'doc-main' },
        el(
          'h4',
          {},
          template.title,
          suggested.includes(template.id) ? el('span', { class: 'badge badge-ok' }, 'needed for move-in') : null,
          template.missing.length > 0
            ? el('span', { class: 'badge badge-warn' }, `${template.missing.length} detail${template.missing.length === 1 ? '' : 's'} blank`)
            : null,
        ),
        el('p', {}, template.description || template.category),
        el(
          'div',
          { class: 'doc-actions' },
          el(
            'button',
            { class: 'btn btn-sm', type: 'button', onClick: () => previewTemplate(template.id, template.title) },
            'Preview',
          ),
        ),
      ),
    );
  });

  const generateButton = el(
    'button',
    {
      class: 'btn btn-primary',
      type: 'button',
      onClick: async () => {
        generateButton.disabled = true;
        generateButton.textContent = 'Generating…';
        try {
          const ids = [...state.selection];
          if (ids.length === 0) {
            toast('Tick at least one document first.', true);
            return;
          }

          const run = async (confirm) => {
            const result = await api(`/api/packs/${pack.id}/generate`, {
              method: 'POST',
              body: JSON.stringify({ templateIds: ids, ...(confirm ? { confirm: true } : {}) }),
            });
            if (result.needsConfirmation === true) {
              return result;
            }
            state.detail = result.pack;
            await refreshPacks();
            renderMain();
            toast(`${result.documents.length} document${result.documents.length === 1 ? '' : 's'} generated.`);
            return null;
          };

          const asked = await run(false);
          if (asked !== null) {
            // Nothing is refused: they are told, and they decide.
            askToContinue(asked, () => run(true));
          }
        } catch (error) {
          toast(error.message, true);
        } finally {
          generateButton.disabled = false;
          generateButton.textContent = 'Generate selected documents';
        }
      },
    },
    'Generate selected documents',
  );

  const generated = documents.length === 0
    ? el(
        'div',
        { class: 'notice notice-info' },
        'No documents generated yet. Tick the ones you need above and press “Generate selected documents”.',
      )
    : el(
        'div',
        { class: 'generated-list' },
        ...documents.map((document) =>
          el(
            'div',
            { class: 'generated-item' },
            el(
              'div',
              { class: 'who' },
              el('strong', {}, document.title),
              el('span', {}, `Generated ${new Date(document.generatedAt).toLocaleString('en-GB')}`),
            ),
            el(
              'div',
              { class: 'what' },
              el(
                'a',
                { class: 'btn btn-sm', href: `/api/documents/${document.id}/download?format=docx` },
                'Word',
              ),
              el(
                'button',
                {
                  class: 'btn btn-sm',
                  type: 'button',
                  onClick: () => {
                    window.open(`/api/documents/${document.id}/download?format=html&inline=1`, '_blank', 'noopener');
                  },
                },
                'Print / PDF',
              ),
              el(
                'a',
                { class: 'btn btn-sm btn-ghost', href: `/api/documents/${document.id}/download?format=md` },
                'Source',
              ),
            ),
          ),
        ),
      );

  return el(
    'div',
    {},
    el(
      'div',
      { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' } },
      el('h3', { style: { fontSize: '.95rem' } }, 'Ready to download'),
      el(
        'span',
        { class: 'small' },
        'Word files for signing · “Print / PDF” opens a print-ready copy',
      ),
    ),
    el('div', { class: 'mt' }, generated),
    el('hr', { class: 'sep' }),
    el('h3', { style: { fontSize: '.95rem', marginBottom: '.2rem' } }, 'What this pack contains'),
    el('p', { class: 'small' }, 'Templates are ticked for you based on what a new tenancy normally needs.'),
    el('div', { class: 'doc-grid mt' }, ...cards),
    el('div', { class: 'form-actions' }, el('span', { class: 'small' }, `${state.selection.size} selected`), generateButton),
  );
}

async function previewTemplate(templateId, title) {
  try {
    const result = await api(`/api/packs/${state.activeId}/preview`, {
      method: 'POST',
      body: JSON.stringify({ templateId }),
    });
    openPreview(title, result.html);
  } catch (error) {
    toast(error.message, true);
  }
}

function openPreview(title, html) {
  const iframe = el('iframe', { title, sandbox: 'allow-same-origin allow-modals' });
  iframe.srcdoc = html;

  const close = () => $('#modal-root').replaceChildren();

  $('#modal-root').replaceChildren(
    el(
      'div',
      { class: 'modal-backdrop', onClick: (event) => { if (event.target === event.currentTarget) close(); } },
      el(
        'div',
        { class: 'modal' },
        el(
          'div',
          { class: 'modal-head' },
          el('h3', {}, title),
          el('button', { class: 'btn btn-sm', type: 'button', onClick: close }, 'Close'),
        ),
        el('div', { class: 'modal-body' }, iframe),
      ),
    ),
  );
}

/* ---------------------------------------------------------------- checks --- */

function renderChecks() {
  const { pack, readiness } = state.detail;
  const { findings, deadlines, counts } = readiness.compliance;

  const group = (severity, title) => {
    const items = findings.filter((finding) => finding.severity === severity);
    if (items.length === 0) return null;
    return el(
      'div',
      { class: 'check-group' },
      el('h3', {}, `${title} (${items.length})`),
      ...items.map((finding) =>
        el(
          'div',
          { class: `check-item sev-${severity}` },
          el('div', {}, el('strong', {}, finding.title), el('p', {}, finding.detail)),
        ),
      ),
    );
  };

  const deadlineNodes = deadlines.length === 0
    ? null
    : el(
        'div',
        { class: 'check-group' },
        el('h3', {}, 'Statutory deadlines'),
        el(
          'div',
          { class: 'deadline-list' },
          ...deadlines.map((deadline) => {
            const days = daysUntil(deadline.date);
            return el(
              'div',
              { class: 'deadline' },
              el(
                'div',
                { class: 'what' },
                deadline.label,
                el('small', {}, deadline.detail),
              ),
              el(
                'div',
                { class: `when${days !== null && days >= 0 && days <= 30 ? ' is-soon' : ''}` },
                fmtDate(deadline.date),
                days === null ? null : el('small', { style: { display: 'block', fontWeight: '400', color: 'var(--muted)' } }, days < 0 ? `${Math.abs(days)} days ago` : days === 0 ? 'today' : `in ${days} days`),
              ),
            );
          }),
        ),
      );

  const notes = el(
    'div',
    { class: 'check-group' },
    el('h3', {}, 'Notes for you'),
    pack.notes.length === 0
      ? el('p', { class: 'small' }, 'No notes yet. The assistant adds notes here when there is something you must do yourself — protecting a deposit, for example.')
      : el(
          'div',
          { class: 'notes-list' },
          ...pack.notes.map((note) =>
            el(
              'div',
              { class: 'note' },
              el('span', {}, note.text),
              el(
                'button',
                {
                  type: 'button',
                  title: 'Delete note',
                  onClick: async () => {
                    try {
                      await api(`/api/packs/${pack.id}/notes/${note.id}`, { method: 'DELETE' });
                      await reloadDetail();
                      renderMain();
                    } catch (error) {
                      toast(error.message, true);
                    }
                  },
                },
                '×',
              ),
            ),
          ),
        ),
    el(
      'div',
      { style: { display: 'flex', gap: '.5rem', marginTop: '.7rem' } },
      el('input', { type: 'text', placeholder: 'Add your own note…', id: 'note-input' }),
      el(
        'button',
        {
          class: 'btn',
          type: 'button',
          onClick: async () => {
            const input = $('#note-input');
            const text = input.value.trim();
            if (text === '') return;
            try {
              await api(`/api/packs/${pack.id}/notes`, { method: 'POST', body: JSON.stringify({ text }) });
              await reloadDetail();
              renderMain();
            } catch (error) {
              toast(error.message, true);
            }
          },
        },
        'Add',
      ),
    ),
  );

  const summary = counts.error === 0 && counts.warning === 0 && counts.info === 0
    ? el('div', { class: 'notice notice-info' }, 'Nothing to report — everything the checks look at is in order.')
    : null;

  return el(
    'div',
    {},
    el(
      'div',
      { style: { display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' } },
      el('span', { class: `badge ${counts.error > 0 ? 'badge-err' : 'badge-ok'}` }, `${counts.error} to fix`),
      el('span', { class: 'badge badge-warn' }, `${counts.warning} to check`),
      el('span', { class: 'badge' }, `${counts.info} notes`),
      el('span', { class: 'spacer' }),
      el(
        'button',
        {
          class: 'btn btn-sm',
          type: 'button',
          onClick: async () => {
            await reloadDetail();
            renderMain();
            toast('Checked again.');
          },
        },
        'Run checks again',
      ),
    ),
    summary,
    group('error', 'Must be fixed before you generate'),
    group('warning', 'Worth checking'),
    group('info', 'For your information'),
    deadlineNodes,
    notes,
    el(
      'p',
      { class: 'small', style: { marginTop: '1.4rem' } },
      `Checks are arithmetic and date comparisons based on a rule set last reviewed ${state.config.rulesReviewedOn}. They are not legal advice.`,
    ),
  );
}

/* ----------------------------------------------------------- back office --- */

/**
 * "Here is what is outstanding — carry on?" The app never refuses; it asks once.
 */
function askToContinue(asked, onContinue) {
  const close = () => $('#modal-root').replaceChildren();

  const items = (asked.findings ?? []).map((finding) =>
    el(
      'div',
      { class: 'check-item sev-warning' },
      el('div', {}, el('strong', {}, finding.title), el('p', {}, finding.detail)),
    ),
  );

  const strict = asked.canGenerate === false;
  const continueButton = el(
    'button',
    {
      class: 'btn btn-primary',
      type: 'button',
      onClick: async () => {
        close();
        await onContinue();
      },
    },
    strict ? 'Generate anyway' : 'Carry on and generate',
  );

  $('#modal-root').replaceChildren(
    el(
      'div',
      { class: 'modal-backdrop', onClick: (event) => { if (event.target === event.currentTarget) close(); } },
      el(
        'div',
        { class: 'modal', style: { height: 'auto', maxHeight: '85vh' } },
        el(
          'div',
          { class: 'modal-head' },
          el('h3', {}, 'Before we carry on'),
          el('button', { class: 'btn btn-sm', type: 'button', onClick: close }, 'Close'),
        ),
        el(
          'div',
          { style: { padding: '1rem', overflowY: 'auto' } },
          el(
            'p',
            { class: 'small' },
            strict
              ? 'Strict mode is on in your settings. Switch it off in Back office → Our details to generate regardless.'
              : 'These are worth a look, but nothing here stops you. Carry on and the pack is produced exactly as it stands, and we will note what you chose to proceed with.',
          ),
          ...items,
          el(
            'div',
            { class: 'form-actions' },
            el('span', { class: 'small' }, `${items.length} item${items.length === 1 ? '' : 's'}`),
            el(
              'div',
              { style: { display: 'flex', gap: '.4rem' } },
              el('button', { class: 'btn', type: 'button', onClick: close }, 'I’ll fix them first'),
              continueButton,
            ),
          ),
        ),
      ),
    ),
  );
}

const BO_TABS = [
  ['settings', 'Our details'],
  ['properties', 'Properties & rooms'],
  ['people', 'Landlords & tenants'],
  ['tidy', 'Tidy up'],
];

async function loadBackOffice() {
  state.backOffice = await api('/api/backoffice');
  return state.backOffice;
}

function renderBackOffice(main) {
  const data = state.backOffice;

  const header = el(
    'div',
    { class: 'pack-head' },
    el(
      'div',
      { class: 'pack-title' },
      el('h2', {}, 'Back office'),
      el('div', { class: 'pack-where' }, 'The details that stay the same, so a new tenancy only asks what changed.'),
    ),
    el(
      'div',
      { class: 'pack-actions' },
      el(
        'button',
        {
          class: 'btn',
          type: 'button',
          onClick: () => {
            state.view = 'tenancy';
            renderMain();
          },
        },
        'Back to tenancies',
      ),
    ),
  );

  const tabs = el(
    'div',
    { class: 'bo-links' },
    ...BO_TABS.map(([id, label]) =>
      el(
        'button',
        {
          class: `btn btn-sm${state.boTab === id ? ' is-active' : ''}`,
          type: 'button',
          onClick: () => {
            state.boTab = id;
            renderMain();
          },
        },
        label,
      ),
    ),
  );

  if (data === null || data === undefined) {
    main.replaceChildren(header, el('p', { class: 'small' }, 'Loading…'));
    return;
  }

  let body;
  if (state.boTab === 'properties') body = renderPropertiesSection(data);
  else if (state.boTab === 'people') body = renderPeopleSection(data);
  else if (state.boTab === 'tidy') body = renderMigrationSection(data);
  else body = renderSettingsSection(data);

  main.replaceChildren(header, tabs, body);
}

function renderSettingsSection(data) {
  const s = data.settings ?? {};
  const field = (key, label, help) =>
    el(
      'div',
      { class: 'field' },
      el('label', { for: `set-${key}` }, label),
      el('input', { id: `set-${key}`, type: 'text', value: s[key] ?? '' }),
      help ? el('span', { class: 'help' }, help) : null,
    );

  const read = (key) => $(`#set-${key}`).value.trim();

  const modeSelect = el(
    'select',
    { id: 'set-reviewMode' },
    el('option', { value: 'relaxed', selected: (s.reviewMode ?? 'relaxed') === 'relaxed' }, 'Relaxed — ask me, then carry on'),
    el('option', { value: 'strict', selected: s.reviewMode === 'strict' }, 'Strict — hold the documents until I fix it'),
  );

  return el(
    'div',
    { class: 'bo-grid' },
    el(
      'div',
      { class: 'bo-section' },
      el('h3', {}, 'Your agency'),
      el('p', { class: 'small' }, 'These appear on every document and pack. Set them once here instead of editing a config file.'),
      field('name', 'Agency name'),
      el('div', { class: 'grid-2' }, field('phone', 'Phone'), field('email', 'Email')),
      field('address', 'Address'),
      el(
        'div',
        { class: 'grid-2' },
        field('clientMoneyScheme', 'Client money protection scheme', 'e.g. Propertymark Client Money Protection'),
        field('redressScheme', 'Redress scheme', 'e.g. The Property Ombudsman'),
      ),
      el(
        'div',
        { class: 'grid-2' },
        field('negotiator', 'Negotiator name', 'Prints on documents that name a person.'),
        field('rentAccount', 'Rent account details', 'Where tenants pay.'),
      ),
      el(
        'div',
        { class: 'form-actions' },
        el('span', { class: 'small' }, 'Saved for every future pack.'),
        el(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            onClick: async () => {
              try {
                await api('/api/settings', {
                  method: 'PUT',
                  body: JSON.stringify({
                    name: read('name'),
                    phone: read('phone'),
                    email: read('email'),
                    address: read('address'),
                    clientMoneyScheme: read('clientMoneyScheme'),
                    redressScheme: read('redressScheme'),
                    negotiator: read('negotiator'),
                    rentAccount: read('rentAccount'),
                    reviewMode: $('#set-reviewMode').value,
                  }),
                });
                toast('Your details are saved.');
                await loadBackOffice();
                renderMain();
              } catch (error) {
                toast(error.message, true);
              }
            },
          },
          'Save our details',
        ),
      ),
    ),
    el(
      'div',
      { class: 'bo-section' },
      el('h3', {}, 'How much should the app push back?'),
      el(
        'p',
        { class: 'small' },
        'This is your paperwork and your decision. In relaxed mode nothing is ever refused: you are told what is outstanding and asked whether to carry on, and the choice is recorded on the pack.',
      ),
      el('div', { class: 'field' }, el('label', { for: 'set-reviewMode' }, 'When something looks missing or wrong'), modeSelect),
    ),
  );
}

function renderPropertiesSection(data) {
  const sections = [];

  for (const property of data.properties) {
    const roomRows = property.rooms.map((room) =>
      el(
        'div',
        { class: 'bo-room' },
        el('span', {}, room.roomNumber === '' ? 'Whole property' : room.roomNumber),
        el(
          'span',
          { class: 'small' },
          [
            room.rentAmount === null ? null : `£${room.rentAmount}`,
            room.status,
            `${room.tenancyCount} tenanc${room.tenancyCount === 1 ? 'y' : 'ies'}`,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
      ),
    );

    const roomNumber = el('input', { type: 'text', placeholder: 'Room number' });
    const rent = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Rent £' });
    const deposit = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Deposit £' });

    sections.push(
      el(
        'div',
        { class: 'bo-section' },
        el('h3', {}, property.addressLine1 === '' ? '(no address)' : property.addressLine1),
        el(
          'p',
          { class: 'small' },
          [property.city, property.postcode, property.landlord === null ? null : property.landlord.name]
            .filter(Boolean)
            .join(' · ') || 'No landlord yet',
        ),
        property.rooms.length > 0
          ? el('div', { class: 'bo-sub' }, ...roomRows)
          : el('p', { class: 'small' }, 'No rooms yet.'),
        el('div', { class: 'grid-2 mt' }, roomNumber, rent, deposit),
        el(
          'div',
          { class: 'form-actions' },
          el('span', { class: 'small' }, 'A room is what a tenancy points at.'),
          el(
            'button',
            {
              class: 'btn',
              type: 'button',
              onClick: async () => {
                try {
                  const toNumber = (text) => (text === '' ? null : Number(text.replace(/[^\d.]/g, '')));
                  await api('/api/backoffice/rooms', {
                    method: 'POST',
                    body: JSON.stringify({
                      propertyId: property.id,
                      roomNumber: roomNumber.value.trim(),
                      rentAmount: toNumber(rent.value),
                      depositAmount: toNumber(deposit.value),
                      status: 'available',
                    }),
                  });
                  toast('Room added.');
                  await loadBackOffice();
                  renderMain();
                } catch (error) {
                  toast(error.message, true);
                }
              },
            },
            'Add room',
          ),
        ),
      ),
    );
  }

  const landlordSelect = el(
    'select',
    {},
    el('option', { value: '' }, '— landlord —'),
    ...data.landlords.map((landlord) => el('option', { value: landlord.id }, landlord.name)),
  );
  const line1 = el('input', { type: 'text', placeholder: 'Address line 1' });
  const city = el('input', { type: 'text', placeholder: 'Town or city' });
  const postcode = el('input', { type: 'text', placeholder: 'Postcode' });

  sections.push(
    el(
      'div',
      { class: 'bo-section' },
      el('h3', {}, 'Add a property'),
      el('p', { class: 'small' }, 'A property is an address. Rooms belong to it, and tenancies point at a room.'),
      el('div', { class: 'grid-2' }, line1, city, postcode, landlordSelect),
      el(
        'div',
        { class: 'form-actions' },
        el('span', { class: 'small' }, `${data.stats.properties} propert${data.stats.properties === 1 ? 'y' : 'ies'}`),
        el(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            onClick: async () => {
              try {
                await api('/api/backoffice/properties', {
                  method: 'POST',
                  body: JSON.stringify({
                    addressLine1: line1.value.trim(),
                    city: city.value.trim(),
                    postcode: postcode.value.trim(),
                    landlordId: landlordSelect.value === '' ? null : landlordSelect.value,
                  }),
                });
                toast('Property added.');
                await loadBackOffice();
                renderMain();
              } catch (error) {
                toast(error.message, true);
              }
            },
          },
          'Add property',
        ),
      ),
    ),
  );

  return el('div', { class: 'bo-grid' }, ...sections);
}

function renderPeopleSection(data) {
  const landlordRows = data.landlords.map((landlord) =>
    el(
      'div',
      { class: 'bo-row' },
      el(
        'div',
        { class: 'bo-what' },
        el('strong', {}, landlord.name === '' ? '(unnamed landlord)' : landlord.name),
        el('span', {}, `${landlord.propertyCount} propert${landlord.propertyCount === 1 ? 'y' : 'ies'}`),
      ),
    ),
  );

  const tenantRows = data.tenants.map((tenant) =>
    el(
      'div',
      { class: 'bo-row' },
      el(
        'div',
        { class: 'bo-what' },
        el('strong', {}, tenant.fullName === '' ? '(unnamed tenant)' : tenant.fullName),
        el(
          'span',
          {},
          [tenant.email, `${tenant.tenancyCount} tenanc${tenant.tenancyCount === 1 ? 'y' : 'ies'}`]
            .filter(Boolean)
            .join(' · '),
        ),
      ),
    ),
  );

  const landlordName = el('input', { type: 'text', placeholder: 'Landlord name' });
  const landlordAddress = el('input', { type: 'text', placeholder: 'Address for notices' });

  return el(
    'div',
    { class: 'bo-grid' },
    el(
      'div',
      { class: 'bo-section' },
      el('h3', {}, 'Landlords'),
      el('p', { class: 'small' }, 'Every landlord you act for. Their name and address go onto every agreement for their properties.'),
      data.landlords.length === 0 ? el('p', { class: 'small' }, 'None yet.') : el('div', {}, ...landlordRows),
      el('div', { class: 'grid-2 mt' }, landlordName, landlordAddress),
      el(
        'div',
        { class: 'form-actions' },
        el('span', { class: 'small' }, `${data.landlords.length} landlord${data.landlords.length === 1 ? '' : 's'}`),
        el(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            onClick: async () => {
              try {
                await api('/api/backoffice/landlords', {
                  method: 'POST',
                  body: JSON.stringify({ name: landlordName.value.trim(), address: landlordAddress.value.trim() }),
                });
                toast('Landlord added.');
                await loadBackOffice();
                renderMain();
              } catch (error) {
                toast(error.message, true);
              }
            },
          },
          'Add landlord',
        ),
      ),
    ),
    el(
      'div',
      { class: 'bo-section' },
      el('h3', {}, 'Tenants'),
      el('p', { class: 'small' }, `Everyone who has ever signed. ${data.stats.tenants} on record.`),
      data.tenants.length === 0 ? el('p', { class: 'small' }, 'None yet.') : el('div', {}, ...tenantRows),
    ),
  );
}

function renderMigrationSection(data) {
  if (data.unlinked.length === 0) {
    return el('div', { class: 'notice notice-info' }, 'Every tenancy is linked to a property. Nothing to tidy up.');
  }

  const planHolder = el('div', {});

  return el(
    'div',
    { class: 'bo-grid' },
    el(
      'div',
      { class: 'bo-section' },
      el('h3', {}, 'Tidy up existing tenancies'),
      el(
        'p',
        { class: 'small' },
        `${data.unlinked.length} tenanc${data.unlinked.length === 1 ? 'y is' : 'ies are'} not linked to a property yet. This finds the properties, rooms, landlords and tenants already in your packs and links them. Nothing is deleted, and you confirm before anything is written.`,
      ),
      planHolder,
      el(
        'div',
        { class: 'form-actions' },
        el('span', { class: 'small' }, 'Review first, then confirm.'),
        el(
          'button',
          {
            class: 'btn',
            type: 'button',
            onClick: async () => {
              try {
                const plan = await api('/api/backoffice/migrate/preview', { method: 'POST', body: '{}' });
                planHolder.replaceChildren(
                  el(
                    'div',
                    { class: 'bo-sub' },
                    el('div', { class: 'bo-room' }, el('span', {}, 'Landlords'), el('span', {}, String(plan.landlords.length))),
                    el('div', { class: 'bo-room' }, el('span', {}, 'Properties'), el('span', {}, String(plan.properties.length))),
                    el('div', { class: 'bo-room' }, el('span', {}, 'Rooms'), el('span', {}, String(plan.rooms.length))),
                    el('div', { class: 'bo-room' }, el('span', {}, 'Tenants'), el('span', {}, String(plan.tenants.length))),
                    ...plan.warnings.map((warning) => el('p', { class: 'small' }, warning)),
                  ),
                  el(
                    'button',
                    {
                      class: 'btn btn-primary mt',
                      type: 'button',
                      onClick: async () => {
                        try {
                          const applied = await api('/api/backoffice/migrate/apply', {
                            method: 'POST',
                            body: JSON.stringify({ confirm: true }),
                          });
                          toast(`Linked ${applied.result.linked} tenanc${applied.result.linked === 1 ? 'y' : 'ies'}.`);
                          await refreshPacks();
                          await loadBackOffice();
                          renderMain();
                        } catch (error) {
                          toast(error.message, true);
                        }
                      },
                    },
                    'Confirm and link',
                  ),
                );
              } catch (error) {
                toast(error.message, true);
              }
            },
          },
          'Show me what it will do',
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ boot --- */

$('#new-pack').addEventListener('click', () => {
  state.view = 'tenancy';
  void createPack();
});

$('#back-office').addEventListener('click', () => {
  void openBackOffice().catch((error) => toast(error.message, true));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const backdrop = $('.modal-backdrop');
    if (backdrop !== null) $('#modal-root').replaceChildren();
  }
});

void boot();
