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
    const [config, fields, templates, packs, custom] = await Promise.all([
      api('/api/config'),
      api('/api/fields'),
      api('/api/templates'),
      api('/api/packs'),
      api('/api/custom-templates'),
    ]);
    state.config = config;
    state.groups = fields.groups;
    state.fields = fields.fields;
    state.templates = templates.templates;
    state.packs = packs.packs;
    state.customTemplates = custom.templates ?? [];

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

/** Where a tenancy is in its life, in the order an agent thinks about them. */
const LIFECYCLE_GROUPS = [
  ['active', 'Active'],
  ['upcoming', 'Starting soon'],
  ['ending', 'Ending'],
  ['ended', 'Ended'],
];

const LIFECYCLE_LABELS = {
  upcoming: 'Upcoming',
  active: 'Active',
  ending: 'Ending',
  ended: 'Ended',
};

function renderSidebar() {
  const list = $('#pack-list');
  $('#pack-count').textContent = String(state.packs.length);
  $('#sidebar-empty').hidden = state.packs.length > 0;

  const item = (pack) => {
    const meta = [];
    if (pack.errorCount > 0) meta.push(el('span', { class: 'badge badge-warn' }, `${pack.errorCount} to look at`));
    else if (pack.ready) meta.push(el('span', { class: 'badge badge-ok' }, 'Complete'));
    else meta.push(el('span', { class: 'badge' }, 'In progress'));

    if (pack.documentCount > 0) {
      meta.push(el('span', { class: 'badge' }, `${pack.documentCount} doc${pack.documentCount === 1 ? '' : 's'}`));
    }
    // A statutory date inside the next month is worth seeing from the list.
    if (pack.dueSoon > 0) {
      meta.push(el('span', { class: 'badge badge-warn' }, `${pack.dueSoon} due`));
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
  };

  // Grouped by where each tenancy sits, so the list reads like a portfolio.
  const grouped = [];
  for (const [id, label] of LIFECYCLE_GROUPS) {
    const inGroup = state.packs.filter((pack) => (pack.lifecycle ?? 'upcoming') === id);
    if (inGroup.length === 0) continue;
    grouped.push(el('li', { class: 'pack-group-title', role: 'presentation' }, `${label} · ${inGroup.length}`));
    grouped.push(...inGroup.map(item));
  }

  list.replaceChildren(...grouped);
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

  if (state.view === 'due') {
    void renderDue(main).catch((error) => {
      main.replaceChildren(el('div', { class: 'notice notice-err' }, error.message));
    });
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
    ['history', 'History', null],
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
            ? el('span', { class: 'badge badge-warn' }, `${errorCount} to look at`)
            : el('span', { class: 'badge badge-ok' }, 'Nothing outstanding'),
          el('span', { class: 'badge' }, `${documents.length} document${documents.length === 1 ? '' : 's'}`),
          el(
            'select',
            {
              class: 'lifecycle-select',
              title: 'Where this tenancy is in its life',
              onChange: async (event) => {
                try {
                  await api(`/api/packs/${pack.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ lifecycle: event.target.value }),
                  });
                  await reloadDetail();
                  await refreshPacks();
                  renderMain();
                } catch (error) {
                  toast(error.message, true);
                }
              },
            },
            ...['upcoming', 'active', 'ending', 'ended'].map((value) =>
              el('option', { value, selected: (pack.lifecycle ?? 'upcoming') === value }, LIFECYCLE_LABELS[value]),
            ),
          ),
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
    case 'history': return renderHistory();
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
        ? ` · ${readiness.missingCore.length} still needed for the agreement`
        : ' · nothing outstanding') +
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
    field.core === true ? el('span', { class: 'field-need' }, 'needed') : null,
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

  if (missing) input.classList.add('is-outstanding');
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
    el('label', {}, field.label, field.core === true ? el('span', { class: 'field-need' }, 'needed') : null),
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
            ? ` · ${readiness.missingCore.length} still needed for the agreement`
            : ' · nothing outstanding'),
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
              document.htmlPath === null
                ? el('span', { class: 'small' }, 'Word only')
                : el(
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
    coverMessagePanel(pack),
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
    customSection(pack),
  );
}

/**
 * The message to the tenant, if the assistant has drafted one — readable and
 * copyable. The agent asked for words to send; they should never have to dig them
 * out of a zip.
 */
function coverMessagePanel(pack) {
  const message = pack?.coverMessage;
  if (message === null || message === undefined) return null;

  const block = (label, text) => {
    if (typeof text !== 'string' || text.trim() === '') return null;
    return el(
      'div',
      { class: 'cover-block' },
      el(
        'div',
        { class: 'cover-head' },
        el('strong', {}, label),
        el(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            type: 'button',
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(text);
                toast(`${label} copied.`);
              } catch {
                toast('Select the text and copy it by hand.', true);
              }
            },
          },
          'Copy',
        ),
      ),
      el('pre', { class: 'cover-text' }, text),
    );
  };

  const blocks = [block('Email to the tenant', message.email), block('WhatsApp', message.whatsapp)].filter(Boolean);
  if (blocks.length === 0) return null;

  return el(
    'div',
    {},
    el(
      'div',
      { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' } },
      el('h3', { style: { fontSize: '.95rem' } }, 'Message to the tenant'),
      el('span', { class: 'small' }, 'Drafted for this pack — copy it, or ask the assistant to change it'),
    ),
    el('div', { class: 'mt' }, ...blocks),
    el('hr', { class: 'sep' }),
  );
}

/** The agency's own uploads, offered for this pack. */
function customSection(pack) {
  const templates = state.customTemplates ?? [];
  if (templates.length === 0) return null;

  const items = templates.map((template) =>
    el(
      'div',
      { class: 'generated-item' },
      el(
        'div',
        { class: 'who' },
        el('strong', {}, template.name),
        el('span', {}, template.fillMode === 'blanks' ? 'fills the blanks of your form' : 'fills your document in place'),
      ),
      el(
        'button',
        {
          class: 'btn btn-sm btn-primary',
          type: 'button',
          onClick: async () => {
            try {
              const result = await api(`/api/packs/${pack.id}/fill/${template.id}`, {
                method: 'POST',
                body: '{}',
              });
              state.detail = result.pack;
              await refreshPacks();
              renderMain();
              const missed = result.report.notFound.length;
              toast(
                missed === 0
                  ? `${template.name} filled — ${result.report.filled} value${result.report.filled === 1 ? '' : 's'}.`
                  : `${template.name} filled, but ${missed} value${missed === 1 ? '' : 's'} not found in the document.`,
                missed !== 0,
              );
            } catch (error) {
              toast(error.message, true);
            }
          },
        },
        'Fill for this tenant',
      ),
    ),
  );

  return el(
    'div',
    {},
    el('hr', { class: 'sep' }),
    el('h3', { style: { fontSize: '.95rem', marginBottom: '.2rem' } }, 'Your own documents'),
    el(
      'p',
      { class: 'small' },
      'Filled from the same details, in your own layout. Upload and map them in Back office → Our documents.',
    ),
    el('div', { class: 'generated-list mt' }, ...items),
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

/**
 * One finding, with a "Why?" that fetches the rule behind it.
 *
 * The rule set already carries a source for every entry; this makes it reachable
 * at the moment somebody is deciding whether to act on the finding.
 */
function checkFinding(finding, severity) {
  const whyBox = el('div', { class: 'why-box', style: { display: 'none' } });
  let loaded = false;

  const why = finding.ruleId === undefined
    ? null
    : el(
        'button',
        {
          class: 'btn btn-ghost btn-sm why-button',
          type: 'button',
          onClick: async () => {
            if (whyBox.style.display !== 'none') {
              whyBox.style.display = 'none';
              return;
            }
            whyBox.style.display = '';
            if (loaded) return;
            loaded = true;
            whyBox.replaceChildren(el('p', { class: 'small' }, 'Looking it up…'));
            try {
              const data = await api(`/api/rules/${encodeURIComponent(finding.ruleId)}`);
              whyBox.replaceChildren(
                el('strong', {}, data.rule.title),
                el('p', {}, data.rule.summary),
                el('ul', {}, ...data.rule.detail.map((line) => el('li', {}, line))),
                el(
                  'a',
                  { class: 'small', href: data.rule.source.url, target: '_blank', rel: 'noopener' },
                  `Source: ${data.rule.source.label}`,
                ),
              );
            } catch (error) {
              whyBox.replaceChildren(el('p', { class: 'small' }, error.message));
            }
          },
        },
        'Why?',
      );

  return el(
    'div',
    { class: `check-item sev-${severity}` },
    el(
      'div',
      { style: { flex: 1 } },
      el('strong', {}, finding.title),
      el('p', {}, finding.detail),
      whyBox,
    ),
    why,
  );
}

/** The record of what was given, when — the page that settles a dispute. */
function renderHistory() {
  const { pack, timeline } = state.detail;
  const events = timeline ?? [];

  const kindLabel = {
    created: 'Opened',
    document: 'Document',
    note: 'Note',
    assistant: 'Assistant',
    message: 'Message',
    status: 'Status',
  };

  const rows = events.map((event) =>
    el(
      'div',
      { class: 'due-row' },
      el(
        'div',
        { class: 'due-when' },
        el('strong', {}, new Date(event.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })),
        el('span', { class: 'small' }, new Date(event.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })),
      ),
      el(
        'div',
        { class: 'due-what' },
        el('strong', {}, event.title),
        el(
          'span',
          { class: 'small' },
          `${kindLabel[event.kind] ?? event.kind}${event.detail === '' ? '' : ` · ${event.detail}`}`,
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
      el(
        'div',
        {},
        el('h3', { style: { fontSize: '.95rem' } }, 'What happened, and when'),
        el('p', { class: 'small' }, 'Everything the app recorded for this tenancy, newest first.'),
      ),
      el(
        'button',
        {
          class: 'btn btn-sm',
          type: 'button',
          onClick: () => {
            window.open(`/api/packs/${pack.id}/timeline.html`, '_blank', 'noopener');
          },
        },
        'Print this history',
      ),
    ),
    events.length === 0
      ? el('div', { class: 'notice notice-info' }, 'Nothing recorded yet.')
      : el('div', { class: 'bo-section mt' }, ...rows),
    el(
      'p',
      { class: 'small', style: { marginTop: '1rem' } },
      'The printed page is the thing to keep for a deposit dispute: tenant, property, rent, deposit and scheme, then every document on the date it was produced.',
    ),
  );
}

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
      ...items.map((finding) => checkFinding(finding, severity)),
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
    group('error', 'Worth fixing before you send'),
    group('warning', 'Worth a look'),
    group('info', 'Background notes'),
    deadlineNodes,
    notes,
    el(
      'p',
      { class: 'small', style: { marginTop: '1.4rem' } },
      `Checks are arithmetic and date comparisons based on a rule set last reviewed ${state.config.rulesReviewedOn}. They are not legal advice.`,
    ),
  );
}

async function renderDue(main) {
  const data = await api('/api/due');

  const buckets = [
    ['Overdue', (item) => item.daysUntil < 0],
    ['Next 7 days', (item) => item.daysUntil >= 0 && item.daysUntil <= 7],
    ['Next 30 days', (item) => item.daysUntil > 7 && item.daysUntil <= 30],
    ['Later', (item) => item.daysUntil > 30],
  ];

  const row = (item) =>
    el(
      'div',
      { class: 'due-row' },
      el(
        'div',
        { class: 'due-when' },
        el('strong', {}, fmtDate(item.date)),
        el(
          'span',
          { class: 'small' },
          item.daysUntil < 0 ? `${Math.abs(item.daysUntil)} days ago` : item.daysUntil === 0 ? 'today' : `in ${item.daysUntil} days`,
        ),
      ),
      el(
        'div',
        { class: 'due-what' },
        el('strong', {}, item.label),
        el('span', { class: 'small' }, `${item.tenantName === '' ? item.reference : item.tenantName} · ${item.propertyAddress}`),
      ),
      el(
        'button',
        {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          onClick: async () => {
            state.view = 'tenancy';
            await selectPack(item.packId);
          },
        },
        'Open',
      ),
    );

  const sections = buckets
    .map(([title, test]) => {
      const items = data.items.filter(test);
      if (items.length === 0) return null;
      return el(
        'div',
        { class: 'bo-section' },
        el('h3', {}, `${title} · ${items.length}`),
        el('div', {}, ...items.map(row)),
      );
    })
    .filter(Boolean);

  main.replaceChildren(
    el(
      'div',
      { class: 'pack-head' },
      el(
        'div',
        { class: 'pack-title' },
        el('h2', {}, 'What’s due'),
        el(
          'div',
          { class: 'pack-where' },
          `${data.overdue} past their date · ${data.soon} in the next 30 days · ${data.items.length} in total`,
        ),
      ),
      el(
        'div',
        { class: 'pack-actions' },
        el('a', { class: 'btn btn-primary', href: '/api/calendar.ics' }, 'Add to calendar'),
        el(
          'button',
          { class: 'btn', type: 'button', onClick: () => { state.view = 'tenancy'; renderMain(); } },
          'Back to tenancies',
        ),
      ),
    ),
    sections.length === 0
      ? el('div', { class: 'notice notice-info' }, 'Nothing due. Every tenancy is up to date.')
      : el('div', { class: 'bo-grid' }, ...sections),
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
  ['documents', 'Our documents'],
  ['health', 'Health & backup'],
  ['tidy', 'Tidy up'],
];

async function loadBackOffice() {
  const [data, custom, health] = await Promise.all([
    api('/api/backoffice'),
    api('/api/custom-templates'),
    api('/api/health'),
  ]);
  state.backOffice = data;
  state.customTemplates = custom.templates ?? [];
  state.health = health;
  return data;
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
  else if (state.boTab === 'documents') body = renderOurDocumentsSection();
  else if (state.boTab === 'health') body = renderHealthSection();
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
    const roomRows = property.rooms.map((room) => {
      const rentInput = el('input', {
        type: 'text',
        inputmode: 'decimal',
        class: 'bo-inline',
        value: room.rentAmount === null ? '' : String(room.rentAmount),
        title: 'Rent',
      });
      const depositInput = el('input', {
        type: 'text',
        inputmode: 'decimal',
        class: 'bo-inline',
        value: room.depositAmount === null ? '' : String(room.depositAmount),
        title: 'Deposit',
      });
      const statusSelect = el(
        'select',
        { class: 'bo-inline' },
        el('option', { value: 'let', selected: room.status === 'let' }, 'Let'),
        el('option', { value: 'available', selected: room.status !== 'let' }, 'Available'),
      );

      const toNumber = (text) => (text === '' ? null : Number(String(text).replace(/[^\d.]/g, '')));

      return el(
        'div',
        { class: 'bo-room bo-room-edit' },
        el('span', { class: 'bo-room-name' }, room.roomNumber === '' ? 'Whole property' : room.roomNumber),
        el('span', { class: 'bo-room-field' }, el('span', { class: 'bo-unit' }, '£'), rentInput),
        el('span', { class: 'bo-room-field' }, el('span', { class: 'bo-unit' }, '£'), depositInput),
        statusSelect,
        el(
          'button',
          {
            class: 'btn btn-sm',
            type: 'button',
            onClick: async () => {
              // These figures are shared. Say who they will reach before saving.
              if (room.tenancyCount > 0) {
                const plural = room.tenancyCount === 1 ? 'tenancy' : 'tenancies';
                const sure = window.confirm(
                  `This room is used by ${room.tenancyCount} ${plural}. Changing the rent or deposit here changes what those ${plural} inherit. Continue?`,
                );
                if (!sure) return;
              }
              try {
                await api(`/api/backoffice/rooms/${room.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    rentAmount: toNumber(rentInput.value),
                    depositAmount: toNumber(depositInput.value),
                    status: statusSelect.value,
                  }),
                });
                toast('Room updated.');
                await loadBackOffice();
                await refreshPacks();
                renderMain();
              } catch (error) {
                toast(error.message, true);
              }
            },
          },
          'Save',
        ),
        room.tenancyCount > 0
          ? el(
              'span',
              { class: 'bo-impact' },
              `used by ${room.tenancyCount} tenanc${room.tenancyCount === 1 ? 'y' : 'ies'}`,
            )
          : null,
      );
    });

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
        bulkLetsPanel(property),
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

/**
 * Let several rooms at once: one row per room, one button, one pack each.
 * Each pack is separate — one tenant never sees another's paperwork.
 */
function bulkLetsPanel(property) {
  if (property.rooms.length === 0) return null;

  const rows = property.rooms.map((room) => {
    const name = el('input', { class: 'bo-inline bo-wide', placeholder: 'Tenant name' });
    const email = el('input', { class: 'bo-inline bo-wide', placeholder: 'Email' });
    const start = el('input', { class: 'bo-inline', type: 'date' });
    return {
      room,
      name,
      email,
      start,
      node: el(
        'div',
        { class: 'bo-room bo-room-edit' },
        el('span', { class: 'bo-room-name' }, room.roomNumber === '' ? 'Whole property' : room.roomNumber),
        name,
        email,
        start,
      ),
    };
  });

  const panel = el(
    'div',
    { class: 'bo-sub', style: { display: 'none' } },
    el('p', { class: 'small' }, 'Fill in the tenants you already have. Each row becomes its own pack, with its own documents.'),
    ...rows.map((row) => row.node),
  );

  const toggle = el(
    'button',
    {
      class: 'btn btn-sm',
      type: 'button',
      onClick: () => {
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
      },
    },
    'Let several rooms',
  );

  const create = el(
    'button',
    {
      class: 'btn btn-primary btn-sm',
      type: 'button',
      onClick: async () => {
        const lets = rows
          .filter((row) => row.name.value.trim() !== '')
          .map((row) => ({
            roomId: row.room.id,
            tenantName: row.name.value.trim(),
            tenantEmail: row.email.value.trim(),
            startDate: row.start.value,
          }));

        if (lets.length === 0) {
          toast('Add a tenant name to at least one room.', true);
          return;
        }

        try {
          const result = await api('/api/packs/bulk', {
            method: 'POST',
            body: JSON.stringify({ lets }),
          });
          toast(`${result.packs} tenanc${result.packs === 1 ? 'y' : 'ies'} created.`);
          await refreshPacks();
          await loadBackOffice();
          renderMain();
        } catch (error) {
          toast(error.message, true);
        }
      },
    },
    'Create the packs',
  );

  return el(
    'div',
    { style: { marginTop: '.6rem' } },
    el('div', { class: 'form-actions' }, el('span', { class: 'small' }, 'One form, several tenancies.'), el('div', { style: { display: 'flex', gap: '.4rem' } }, toggle, create)),
    panel,
  );
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

/* ------------------------------------------------- their own documents --- */

/** A picker listing every detail the app holds, for mapping one value. */
function fieldPicker(value, onChange) {
  const groups = new Map();
  for (const field of state.fields) {
    if (!groups.has(field.group)) groups.set(field.group, []);
    groups.get(field.group).push(field);
  }
  const selects = el(
    'select',
    { class: 'field-map' },
    el('option', { value: '' }, '— not used —'),
    ...[...groups.entries()].map(([groupId, fields]) => {
      const label = state.groups.find((group) => group.id === groupId)?.title ?? groupId;
      return el(
        'optgroup',
        { label },
        ...fields.map((field) => el('option', { value: field.key, selected: value === field.key }, field.label)),
      );
    }),
  );
  selects.addEventListener('change', () => onChange(selects.value));
  return selects;
}

function renderOurDocumentsSection() {
  const templates = state.customTemplates ?? [];

  const fileInput = el('input', { type: 'file', accept: '.docx', id: 'upload-file' });
  const nameInput = el('input', { type: 'text', id: 'upload-name', placeholder: 'What shall we call it? e.g. Our tenancy agreement' });

  const cards = templates.map((template) => {
    const audit = template.audit ?? { counts: { error: 0, warning: 0, info: 0 }, findings: [] };
    const state_ = (template.links ?? []).slice();
    const blanks_ = (template.blankFields ?? []).slice();
    let mode = template.fillMode ?? 'values';
    const editor = el('div', {});

    const drawEditor = () => {
      if (mode === 'blanks') {
        const rows = blanks_.map((field, index) =>
          el(
            'div',
            { class: 'map-row' },
            el('span', { class: 'map-sample' }, `Blank ${index + 1}`),
            fieldPicker(field, (next) => {
              blanks_[index] = next;
            }),
            el(
              'button',
              {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                onClick: () => {
                  blanks_.splice(index, 1);
                  drawEditor();
                },
              },
              'Remove',
            ),
          ),
        );
        editor.replaceChildren(
          el(
            'p',
            { class: 'small' },
            `This looks like a blank form with ${audit.wordCount === 0 ? 'several' : ''} spaces. Pick which detail goes in each space, in the order they appear.`,
          ),
          ...rows,
          el(
            'button',
            {
              class: 'btn btn-sm',
              type: 'button',
              onClick: () => {
                blanks_.push('');
                drawEditor();
              },
            },
            'Add a blank',
          ),
        );
      } else {
        const rows = state_.map((link, index) =>
          el(
            'div',
            { class: 'map-row' },
            el('span', { class: 'map-sample', title: link.sample }, link.sample.length > 42 ? `${link.sample.slice(0, 42)}…` : link.sample),
            link.field === '' ? el('span', { class: 'badge badge-warn' }, 'choose') : null,
            fieldPicker(link.field, (next) => {
              state_[index].field = next;
            }),
            el(
              'button',
              {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                onClick: () => {
                  state_.splice(index, 1);
                  drawEditor();
                },
              },
              'Remove',
            ),
          ),
        );
        editor.replaceChildren(
          el(
            'p',
            { class: 'small' },
            state_.some((link) => link.field === '')
              ? 'These are the parts that change between tenants. Anything marked “choose” needs you to say which detail it is.'
              : 'These are the parts that change between tenants. Check each one, then save.',
          ),
          ...rows,
          el(
            'div',
            { class: 'map-row' },
            el('input', { type: 'text', placeholder: 'Text to replace', id: `add-sample-${template.id}` }),
            el(
              'button',
              {
                class: 'btn btn-sm',
                type: 'button',
                onClick: () => {
                  const input = $(`#add-sample-${template.id}`);
                  const sample = input.value.trim();
                  if (sample === '') return;
                  state_.push({ sample, field: '' });
                  drawEditor();
                },
              },
              'Add a value',
            ),
          ),
        );
      }
    };

    drawEditor();

    return el(
      'div',
      { class: 'bo-section' },
      el('h3', {}, template.name),
      el(
        'p',
        { class: 'small' },
        `${template.fileName} · ${template.wordCount} words · ` +
          (audit.counts.error > 0
            ? `${audit.counts.error} thing${audit.counts.error === 1 ? '' : 's'} worth fixing`
            : 'nothing to flag'),
      ),
      audit.findings.length > 0
        ? el(
            'div',
            { class: 'bo-sub' },
            ...audit.findings.slice(0, 4).map((finding) =>
              el('div', { class: 'bo-room' }, el('span', {}, finding.title), el('span', { class: 'small' }, finding.severity)),
            ),
          )
        : null,
      el(
        'div',
        { class: 'map-row', style: { marginTop: '.6rem' } },
        el(
          'select',
          {
            class: 'bo-inline',
            onChange: (event) => {
              mode = event.target.value;
              drawEditor();
            },
          },
          el('option', { value: 'values', selected: mode === 'values' }, 'Fill values in place'),
          el('option', { value: 'blanks', selected: mode === 'blanks' }, 'Fill in the blanks'),
        ),
        el('span', { class: 'small' }, mode === 'values' ? 'Replaces the previous tenant’s details' : 'Fills each ______ in order'),
      ),
      editor,
      el(
        'div',
        { class: 'form-actions' },
        el(
          'button',
          {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            onClick: async () => {
              if (!window.confirm(`Remove “${template.name}”? The original file is deleted.`)) return;
              try {
                await api(`/api/custom-templates/${template.id}`, { method: 'DELETE' });
                await loadBackOffice();
                renderMain();
              } catch (error) {
                toast(error.message, true);
              }
            },
          },
          'Remove',
        ),
        el(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            onClick: async () => {
              try {
                await api(`/api/custom-templates/${template.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ fillMode: mode, links: state_, blankFields: blanks_ }),
                });
                toast('Saved.');
                await loadBackOffice();
                renderMain();
              } catch (error) {
                toast(error.message, true);
              }
            },
          },
          'Save mapping',
        ),
      ),
    );
  });

  const upload = el(
    'button',
    {
      class: 'btn btn-primary',
      type: 'button',
      onClick: async () => {
        const file = fileInput.files?.[0];
        if (!file) {
          toast('Choose a .docx file first.', true);
          return;
        }
        try {
          const buffer = await file.arrayBuffer();
          let binary = '';
          const bytes = new Uint8Array(buffer);
          for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
          const data = btoa(binary);
          await api('/api/custom-templates', {
            method: 'POST',
            body: JSON.stringify({ name: nameInput.value.trim(), fileName: file.name, data }),
          });
          toast('Uploaded. Check the mapping below.');
          await loadBackOffice();
          renderMain();
        } catch (error) {
          toast(error.message, true);
        }
      },
    },
    'Upload',
  );

  return el(
    'div',
    { class: 'bo-grid' },
    el(
      'div',
      { class: 'bo-section' },
      el('h3', {}, 'Use your own documents'),
      el(
        'p',
        { class: 'small' },
        'Upload a Word file and the app fills it for each tenant — your letterhead, your numbering, your wording. If you only have a PDF, open it in Word and save it as .docx first.',
      ),
      el('div', { class: 'grid-2' }, fileInput, nameInput),
      el('div', { class: 'form-actions' }, el('span', { class: 'small' }, `${templates.length} uploaded`), upload),
    ),
    ...cards,
  );
}

function renderHealthSection() {
  const health = state.health ?? {};
  const store = health.store ?? {};
  const back = health.backOffice ?? {};
  const disk = health.disk ?? {};

  const bytes = (value) => {
    if (typeof value !== 'number') return '—';
    const units = ['bytes', 'KB', 'MB', 'GB'];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  };

  const fact = (label, value) =>
    el(
      'div',
      { class: 'bo-row' },
      el('div', { class: 'bo-what' }, el('strong', {}, label)),
      el('span', { class: 'small' }, String(value)),
    );

  return el(
    'div',
    { class: 'bo-grid' },
    el(
      'div',
      { class: 'bo-section' },
      el('h3', {}, 'Backup'),
      el(
        'p',
        { class: 'small' },
        'One file with everything: the database, every document generated, and every original you uploaded. Keep the copy somewhere that is not this computer.',
      ),
      el(
        'div',
        { class: 'form-actions' },
        el('span', { class: 'small' }, 'Taken without stopping anything.'),
        el('a', { class: 'btn btn-primary', href: '/api/backup' }, 'Download a backup'),
      ),
    ),
    el(
      'div',
      { class: 'bo-section' },
      el('h3', {}, 'Where things stand'),
      fact('Tenancies', store.packs ?? 0),
      fact('Documents generated', store.documents ?? 0),
      fact('Assistant runs logged', store.runs ?? 0),
      fact('Landlords · properties · rooms · tenants', `${back.landlords ?? 0} · ${back.properties ?? 0} · ${back.rooms ?? 0} · ${back.tenants ?? 0}`),
      fact('Your documents uploaded', health.uploads ?? 0),
      fact('Templates', `${health.templates ?? 0} · ${(health.templateWarnings ?? []).length} warning(s)`),
      fact('Assistant', health.assistantAvailable ? `ready (${health.model})` : 'off — no API key'),
      fact('Database file', bytes(disk.databaseBytes)),
      fact('Generated documents on disk', `${disk.documentCount ?? 0} files`),
      fact('Disk space free', typeof disk.freeBytes === 'number' ? bytes(disk.freeBytes) : 'not reported'),
      fact('Data folder', disk.dataDir ?? '—'),
      fact('Node', health.node ?? '—'),
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

$('#due').addEventListener('click', () => {
  state.view = 'due';
  renderMain();
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
