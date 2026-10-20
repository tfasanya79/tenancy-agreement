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
  const byGroup = new Map(state.groups.map((group) => [group.id, []]));
  for (const field of state.fields) {
    if (byGroup.has(field.group)) byGroup.get(field.group).push(field);
  }

  const filled = state.fields.filter((field) => {
    if (field.type === 'people') {
      const people = pack.fields[field.key];
      return Array.isArray(people) && people.some((person) => person && person.full_name);
    }
    const value = pack.fields[field.key];
    return value !== undefined && value !== null && String(value).trim() !== '';
  }).length;

  const progress = el(
    'div',
    { class: 'progress', id: 'form-progress' },
    el('strong', {}, `${filled} of ${state.fields.length}`),
    ' details filled in' +
      (readiness.missingCore.length > 0
        ? ` · ${readiness.missingCore.length} essential${readiness.missingCore.length === 1 ? '' : 's'} still missing`
        : ' · everything essential is here'),
  );

  const sections = state.groups
    .map((group) => {
      const fields = byGroup.get(group.id);
      if (fields === undefined || fields.length === 0) return null;
      const open = ['tenants', 'property', 'tenancy'].includes(group.id) || fields.some((field) => isMissing(pack, field));
      return el(
        'details',
        { class: 'form-section', open: open },
        el(
          'summary',
          {},
          el('span', {}, group.title),
          el('span', { class: 'section-blurb' }, group.blurb),
        ),
        el('div', { class: 'form-body' }, ...fields.map((field) => renderField(field, pack))),
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
    pack.fields === null || Object.keys(pack.fields).length === 0
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

function isMissing(pack, field) {
  if (field.type === 'people') {
    const people = pack.fields[field.key];
    return !(Array.isArray(people) && people.some((person) => person && person.full_name));
  }
  const value = pack.fields[field.key];
  return value === undefined || value === null || String(value).trim() === '';
}

function renderField(field, pack) {
  if (field.type === 'people') return renderPeopleField(field, pack);

  const value = pack.fields[field.key] ?? '';
  const missing = field.core === true && isMissing(pack, field);

  let input;
  const common = {
    id: `field-${field.key}`,
    'data-field': field.key,
    onInput: queueSave,
    onChange: queueSave,
  };

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
    return el(
      'div',
      { class: 'field' },
      el('label', { for: `field-${field.key}` }, field.label, field.core === true ? el('span', { class: 'is-missing' }, ' *') : null),
      el('div', { class: 'money-input' }, el('span', { class: 'prefix' }, '£'), inner),
      field.help ? el('span', { class: 'help' }, field.help) : null,
    );
  } else {
    input = el('input', { ...common, type: 'text', value: String(value), placeholder: field.placeholder || '' });
  }

  if (missing) input.classList.add('is-required-empty');

  return el(
    'div',
    { class: 'field' },
    el(
      'label',
      { for: `field-${field.key}` },
      field.label,
      field.core === true ? el('span', { class: 'is-missing' }, ' *') : null,
    ),
    input,
    field.help ? el('span', { class: 'help' }, field.help) : null,
  );
}

function renderPeopleField(field, pack) {
  const people = Array.isArray(pack.fields[field.key]) ? pack.fields[field.key] : [];
  const container = el('div', { 'data-people': field.key });

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
              queueSave();
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
              ? el('textarea', { 'data-person-key': child.key, onInput: queueSave }, person[child.key] ?? '')
              : el('input', {
                  type: child.type === 'date' ? 'date' : 'text',
                  'data-person-key': child.key,
                  value: person[child.key] ?? '',
                  placeholder: child.placeholder || '',
                  onInput: queueSave,
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
          queueSave();
        },
      },
      'Add another tenant',
    ),
  );
}

function collectFields() {
  const fields = {};

  document.querySelectorAll('[data-field]').forEach((input) => {
    const key = input.dataset.field;
    const value = input.value;
    if (value !== '') fields[key] = value;
  });

  document.querySelectorAll('[data-people]').forEach((container) => {
    const key = container.dataset.people;
    const people = [...container.querySelectorAll('.person-card')]
      .map((card) => {
        const person = {};
        card.querySelectorAll('[data-person-key]').forEach((input) => {
          if (input.value.trim() !== '') person[input.dataset.personKey] = input.value;
        });
        return person;
      })
      .filter((person) => Object.keys(person).length > 0);
    if (people.length > 0) fields[key] = people;
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

    const progress = $('#form-progress');
    if (progress !== null) {
      const readiness = updated.readiness;
      const filled = state.fields.filter((field) => {
        if (field.type === 'people') {
          const people = updated.pack.fields[field.key];
          return Array.isArray(people) && people.some((person) => person && person.full_name);
        }
        const value = updated.pack.fields[field.key];
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
          const result = await api(`/api/packs/${pack.id}/generate`, {
            method: 'POST',
            body: JSON.stringify({ templateIds: ids }),
          });
          state.detail = result.pack;
          await refreshPacks();
          renderMain();
          toast(`${result.documents.length} document${result.documents.length === 1 ? '' : 's'} generated.`);
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

/* ------------------------------------------------------------------ boot --- */

$('#new-pack').addEventListener('click', createPack);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const backdrop = $('.modal-backdrop');
    if (backdrop !== null) $('#modal-root').replaceChildren();
  }
});

void boot();
