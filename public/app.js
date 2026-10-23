/* ==========================================================================
   TenancyDesk — browser application
   Plain JavaScript, no build step, no framework. Everything the letting agent
   sees is rendered from the API described in docs/API.md.
   ========================================================================== */

'use strict';

/* ---------------------------------------------------------------- state --- */

const state = {
  /** The signed-in person: { id, name, email, role, landlordId, landlordName }. */
  me: null,
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
  boTab: 'overview',
  backOffice: null,
  /** Fields the user has actually typed, so inherited values are not frozen. */
  dirty: new Set(),
  selection: new Set(),
  chat: new Map(), // packId -> [{ role, text, trace }]
  /** Which guide is being followed, and what the server last said about this pack. */
  guide: null,
  guidance: null,
  guidanceFor: null,
  /** Steps skipped this session: navigation, never a claim of progress. */
  guideSkipped: [],
  /** Set when the person takes the zip, because a download cannot be observed. */
  guideDownloaded: false,
  streaming: false,
  saveTimer: null,
};



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
  // Only claim to be sending JSON when there is a body: the server rejects an
  // empty body sent as application/json, which is what made Delete fail with
  // "Body cannot be empty when content-type is set to 'application/json'".
  const headers = { ...(options.headers ?? {}) };
  if (options.body !== undefined && options.body !== null) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return null;
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    // A session that has expired or been revoked goes back to the door, rather
    // than showing "Please sign in" as an error over a page it cannot load.
    if (response.status === 401 && data && data.signedOut === true) signedOut();
    throw new Error((data && data.error) || `Request failed (${response.status})`);
  }
  return data;
}

/* ------------------------------------------------------------- lifecycle --- */

async function boot() {
  try {
    const status = await api('/api/auth/status');
    if (status.needsSetup === true) return renderSetupScreen();
    if (status.signedIn !== true) return renderSignInScreen();
    state.me = status.user;
    // An interface served from cache can be older than the server that answers it. If
    // the person's shape is not the one this build knows, ask again rather than
    // quietly hiding whatever the missing field gates.
    if (state.me !== null && state.me.isOperator === undefined) {
      state.me = await api('/api/auth/me');
    }
    await loadWorkspace();
  } catch (error) {
    $('#main').replaceChildren(
      el('div', { class: 'notice notice-err' }, `TenancyDesk could not load: ${error.message}`),
    );
  }
}

/** Everything a signed-in person needs. Called at boot and after signing in. */
async function loadWorkspace() {
  document.body.classList.remove('is-gate');
  const [config, fields, templates, packs, custom] = await Promise.all([
    api('/api/config'),
    api('/api/fields'),
    api('/api/templates'),
    api('/api/packs'),
    // A landlord has no access to the agency's uploads, and does not need them.
    state.me?.role === 'landlord' ? Promise.resolve({ templates: [] }) : api('/api/custom-templates'),
  ]);
  state.config = config;
  state.groups = fields.groups;
  state.fields = fields.fields;
  state.templates = templates.templates;
  state.packs = packs.packs;
  state.customTemplates = custom.templates ?? [];

  renderStatus();
  renderIdentity();
  renderSidebar();
  // Their own feedback, so "it went somewhere" is visible rather than assumed.
  await loadMyFeedback();
  renderFeedbackPill();

  if (state.packs.length > 0) {
    await selectPack(state.packs[0].id, { keepTab: false });
  } else {
    renderMain();
  }
}

/* ---------------------------------------------------------------- identity --- */

/**
 * Check that the page still knows who it is talking for.
 *
 * A tab can sit open for days, and the cookie underneath it can change — somebody
 * signs in as a different account in another tab — leaving the page drawing buttons
 * for a person the server no longer recognises. It happened once: a queue button that
 * led to a refusal, because the identity was two days old. Ask whenever the tab comes
 * back into view.
 */
async function reconcileIdentity() {
  if (state.me === null) return;
  try {
    const me = await api('/api/auth/me');
    if (me === null) return;
    const changed =
      me.id !== state.me.id ||
      me.isOperator !== state.me.isOperator ||
      me.role !== state.me.role ||
      me.email !== state.me.email;
    if (!changed) return;
    // A different account is signed in: its packs, its permissions, its screens.
    state.me = me;
    state.detail = null;
    state.packs = [];
    state.chat.clear();
    await loadWorkspace();
  } catch {
    // A session that has gone is handled by api(), which shows the sign-in screen.
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void reconcileIdentity();
});
window.addEventListener('focus', () => void reconcileIdentity());


const myRole = () => state.me?.role ?? 'agent';
const isOwner = () => myRole() === 'owner';
const isLandlord = () => myRole() === 'landlord';
/** Staff change things; a landlord only looks. */
const canWrite = () => !isLandlord();

function renderIdentity() {
  const who = $('#whoami');
  const out = $('#sign-out');
  const newPack = $('#new-pack');
  const backOffice = $('#back-office');
  if (state.me === null) {
    who.hidden = true;
    out.hidden = true;
    feedbackState.open = false;
    feedbackState.messages = [];
    feedbackState.proposal = null;
    feedbackState.mine = [];
    renderFeedbackPill();
    return;
  }

  who.hidden = false;
  out.hidden = false;
  out.onclick = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Signing out locally matters more than the round trip succeeding.
    }
    state.me = null;
    state.packs = [];
    state.detail = null;
    state.chat.clear();
    renderSignInScreen();
  };

  who.textContent = '';
  who.append(
    el('strong', {}, state.me.name || state.me.email),
    el('span', { class: 'whoami-role' }, isLandlord() ? `Landlord · ${state.me.landlordName ?? 'no property'}` : isOwner() ? 'Owner' : 'Agent'),
  );

  // The interface offers only what the server would allow.
  newPack.hidden = isLandlord();
  backOffice.hidden = isLandlord();

  // An operator gets a direct way in, with a count: hunting through a row of tabs is
  // how a feature gets reported as missing.
  const feedbackButton = $('#open-feedback');
  if (feedbackButton !== null) {
    feedbackButton.hidden = state.me.isOperator !== true;
    feedbackButton.onclick = () => openFeedbackQueue();
    if (state.me.isOperator === true) {
      void api('/api/feedback/summary')
        .then((summary) => {
          const waiting = Number(summary?.counts?.new ?? 0) + Number(summary?.counts?.triaged ?? 0);
          feedbackButton.textContent = waiting > 0 ? `Feedback · ${waiting}` : 'Feedback';
          feedbackButton.title =
            waiting > 0
              ? `${waiting} waiting for you — new or being looked at`
              : 'Everything filed has been triaged';
        })
        .catch(() => {
          feedbackButton.textContent = 'Feedback';
        });
    }
  }

  renderFeedbackPill();
}

/** Straight to the queue, for the person who owns the product. */
function openFeedbackQueue() {
  state.view = 'feedback';
  renderMain();
}

/* ------------------------------------------------------------------- gate --- */

/** A full-width card in place of the app, for signing in or setting up. */
function gateCard({ title, blurb, fields, submitLabel, onSubmit, footer }) {
  document.body.classList.add('is-gate');
  const error = el('div', { class: 'notice notice-err', hidden: true });
  const inputs = new Map();

  const rows = fields.map((field) => {
    const input = el('input', {
      type: field.type ?? 'text',
      id: `gate-${field.name}`,
      placeholder: field.placeholder ?? '',
      autocomplete: field.autocomplete ?? 'off',
      autofocus: field.autofocus === true ? true : null,
    });
    inputs.set(field.name, input);
    return el('div', { class: 'field' }, el('label', { for: `gate-${field.name}` }, field.label), input, field.help ? el('span', { class: 'help' }, field.help) : null);
  });

  const button = el('button', { class: 'btn btn-primary', type: 'submit' }, submitLabel);
  const form = el(
    'form',
    {
      class: 'gate-card',
      onSubmit: async (event) => {
        event.preventDefault();
        error.hidden = true;
        button.disabled = true;
        const values = {};
        for (const [name, input] of inputs) values[name] = input.value;
        try {
          await onSubmit(values);
        } catch (caught) {
          error.textContent = caught.message;
          error.hidden = false;
          button.disabled = false;
        }
      },
    },
    el('h2', {}, title),
    el('p', { class: 'small' }, blurb),
    error,
    ...rows,
    el('div', { class: 'form-actions' }, el('span', {}), button),
    footer ?? null,
  );

  $('#main').replaceChildren(el('div', { class: 'gate' }, form));
}

function renderSignInScreen() {
  document.body.classList.add('is-gate');
  renderIdentity();
  gateCard({
    title: 'Sign in',
    blurb: 'TenancyDesk holds tenant personal data, so it asks who you are first.',
    fields: [
      { name: 'email', label: 'Email', type: 'email', autocomplete: 'username', autofocus: true },
      { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' },
    ],
    submitLabel: 'Sign in',
    onSubmit: async (values) => {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: values.email, password: values.password }),
      });
      state.me = result.user;
      await loadWorkspace();
    },
    // There is no sign-up: an account is something a person is given, not something
    // they create. Saying so here saves the hunt for a button that does not exist.
    footer: el(
      'p',
      { class: 'small' },
      'There is no sign-up on this page. An account is created for you by your agency’s owner, in Back office → People & access — ask them if you have not been given a login, or if your password has stopped working.',
    ),
  });
}

function renderSetupScreen() {
  document.body.classList.add('is-gate');
  gateCard({
    title: 'Set up TenancyDesk',
    blurb:
      'There are no accounts yet. This one is the owner: it can do everything, including adding the other agents and landlords.',
    fields: [
      { name: 'name', label: 'Your name', placeholder: 'Mary Ajala', autofocus: true },
      { name: 'email', label: 'Your email', type: 'email', placeholder: 'you@youragency.co.uk', autocomplete: 'username' },
      { name: 'password', label: 'A password', type: 'password', autocomplete: 'new-password', help: 'At least 12 characters. Three unconnected words is a good password.' },
      { name: 'confirm', label: 'The same password again', type: 'password', autocomplete: 'new-password' },
    ],
    submitLabel: 'Create the owner account',
    onSubmit: async (values) => {
      if (values.password !== values.confirm) throw new Error('The two passwords do not match.');
      const result = await api('/api/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ name: values.name, email: values.email, password: values.password }),
      });
      state.me = result.user;
      await loadWorkspace();
    },
    footer: el(
      'p',
      { class: 'small' },
      'Nobody else can reach this screen once it is done — after this, accounts are added from Back office → People & access.',
    ),
  });
}

/** A refused session anywhere drops the interface back to the door. */
function signedOut() {
  state.me = null;
  state.detail = null;
  state.packs = [];
  state.chat.clear();
  renderSignInScreen();
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
  // A guide belongs to the pack it was started on.
  state.guide = null;
  state.guidance = null;
  state.guideDownloaded = false;
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

  // The queue is its own view. Gating it inside the back office meant a stale identity
  // payload — or any change to the tab rules — silently turned this button into the
  // settings screen, which is exactly how it was reported.
  if (state.view === 'feedback') {
    renderFeedbackQueue(main);
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
        el(
          'div',
          { style: { display: 'flex', gap: '.5rem', justifyContent: 'center', flexWrap: 'wrap' } },
          el('button', { class: 'btn btn-primary', type: 'button', onClick: createPack }, 'Create your first pack'),
          el(
            'button',
            { class: 'btn', type: 'button', onClick: () => void openOurDocuments() },
            'Upload my own documents',
          ),
        ),
        el(
          'p',
          { class: 'small', style: { marginTop: '.8rem' } },
          'Already have your own agreement, inventory report or notice? Upload it once and every pack uses your layout.',
        ),
      ),
    );
    return;
  }

  const { pack, readiness, documents } = state.detail;
  const title = pack.tenantName || 'Unnamed tenant';
  const errorCount = readiness.compliance.counts.error;

  // A landlord gets no assistant and no checks: one writes to the pack, the other
  // is an opinion about it. They get the details, the documents and the history.
  const documentTab = ['documents', 'Documents', documents.length > 0 ? documents.length : null];
  const tabs = canWrite()
    ? [
        ['assistant', 'Assistant', null],
        ['details', 'Details', null],
        documentTab,
        ['checks', 'Checks', errorCount > 0 ? errorCount : null],
        ['history', 'History', null],
      ]
    : [['details', 'Details', null], documentTab, ['history', 'History', null]];

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
          canWrite()
            ? el(
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
              )
            : el('span', { class: 'badge' }, LIFECYCLE_LABELS[pack.lifecycle ?? 'upcoming']),
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
        canWrite()
          ? el('button', { class: 'btn btn-danger btn-sm', type: 'button', onClick: deletePack }, 'Delete')
          : null,
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
          el('div', { class: 'msg-bubble' }, ...renderMessageText(message.text, { markdown: false })),
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
          { class: 'msg-body' },
          trace,
          el('div', { class: 'msg-bubble' }, ...renderMessageText(message.text)),
          copyReplyButton(message.text),
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

  // The guide lives in its own dock above the transcript: a guide whose own step sends a
  // message used to destroy the rail it had just used, because it was mounted inside the log.
  const dock = el('div', { class: 'guide-dock', id: 'guide-dock' });
  void drawGuidanceDock(packId, dock);
  const top = el('div', { class: 'assistant-top' }, notice, dock);

  const content = el('div', { class: 'assistant' }, top, log, composer);
  requestAnimationFrame(() => {
    const logNow = $('#chat-log');
    if (logNow) logNow.scrollTop = logNow.scrollHeight;
  });
  return content;
}

/* -- message formatting -----------------------------------------------------
   The assistant writes Markdown. Showing the source is what made a drafted
   letter land as a wall of asterisks, so a reply is rendered: bold, italic,
   code, links, headings, labels, bullets, numbered steps and quotes. Line
   breaks are kept as written, because a letter has lines that matter.

   Nothing here trusts the text. Every node is built with the DOM, never
   innerHTML, and only http(s), mailto: and same-site links become clickable.
   This block is deliberately self-contained so the tests can load it into a
   stub DOM — see tests/message-format.test.ts. */

// One pattern, but a fresh copy per call: inlineNodes recurses into its own
// matches, and a shared /g regex would have its lastIndex reset mid-scan.
const INLINE_SOURCE = '(\\*\\*[^*\\n]+\\*\\*|`[^`\\n]+`|\\*[^*\\n]+\\*|\\[[^\\]\\n]+\\]\\([^)\\s]+\\))';
const BULLET_LINE = /^[-*•+]\s+/;
const NUMBER_LINE = /^\d+[.)]\s+/;
const RULE_LINE = /^(?:-{3,}|\*{3,}|_{3,})$/;

function inlineNode(token) {
  if (token.startsWith('`')) return el('code', {}, token.slice(1, -1));
  if (token.startsWith('**')) return el('strong', {}, ...inlineNodes(token.slice(2, -2)));
  if (token.startsWith('[')) {
    const parts = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
    const href = parts ? parts[2] : '';
    if (href !== '' && /^(https?:\/\/|mailto:|\/)/i.test(href)) {
      return el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, parts[1]);
    }
    return document.createTextNode(token);
  }
  return el('em', {}, ...inlineNodes(token.slice(1, -1)));
}

function inlineNodes(text) {
  const source = String(text);
  const pattern = new RegExp(INLINE_SOURCE, 'g');
  const nodes = [];
  let last = 0;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    if (match.index > last) nodes.push(document.createTextNode(source.slice(last, match.index)));
    nodes.push(inlineNode(match[0]));
    last = match.index + match[0].length;
  }
  if (last < source.length) nodes.push(document.createTextNode(source.slice(last)));
  return nodes;
}

function renderMessageText(text, options = {}) {
  const markdown = options.markdown !== false;
  const inline = (value) => (markdown ? inlineNodes(value) : [document.createTextNode(String(value))]);
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const nodes = [];
  let paragraph = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    const children = [];
    paragraph.forEach((line, index) => {
      if (index > 0) children.push(el('br'));
      children.push(...inline(line));
    });
    nodes.push(el('p', {}, ...children));
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (line === '') {
      flush();
      continue;
    }

    if (markdown && RULE_LINE.test(line)) {
      flush();
      nodes.push(el('hr'));
      continue;
    }

    const heading = markdown ? /^(#{1,4})\s+(.+)$/.exec(line) : null;
    if (heading) {
      flush();
      nodes.push(el(heading[1].length <= 2 ? 'h4' : 'h5', {}, ...inline(heading[2])));
      continue;
    }

    // A line that is nothing but **Email** is a label, not a sentence.
    const label = markdown ? /^\*\*([^*]+)\*\*:?$/.exec(line) : null;
    if (label) {
      flush();
      nodes.push(el('div', { class: 'msg-label' }, ...inline(label[1])));
      continue;
    }

    if (markdown && /^>\s?/.test(line)) {
      flush();
      const quoted = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoted.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      index -= 1;
      nodes.push(el('blockquote', {}, ...renderMessageText(quoted.join('\n'), { markdown })));
      continue;
    }

    if (markdown && (BULLET_LINE.test(line) || NUMBER_LINE.test(line))) {
      flush();
      const ordered = NUMBER_LINE.test(line);
      const marker = ordered ? NUMBER_LINE : BULLET_LINE;
      const items = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        if (marker.test(current)) {
          items.push([current.replace(marker, '')]);
        } else if (items.length > 0 && /^\s{2,}\S/.test(lines[index]) && !RULE_LINE.test(current)) {
          // An indented line under a bullet carries on that bullet.
          items[items.length - 1].push(current);
        } else {
          break;
        }
        index += 1;
      }
      index -= 1;
      nodes.push(
        el(
          ordered ? 'ol' : 'ul',
          {},
          ...items.map((itemLines) => {
            const children = [];
            itemLines.forEach((itemLine, position) => {
              if (position > 0) children.push(el('br'));
              children.push(...inline(itemLine));
            });
            return el('li', {}, ...children);
          }),
        ),
      );
      continue;
    }

    paragraph.push(line);
  }

  flush();
  if (nodes.length === 0) nodes.push(el('p', {}, String(text ?? '')));
  return nodes;
}

/** The same words without the Markdown, for pasting into an email or WhatsApp. */
function messagePlainText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[^\S\n]*[-*•+][^\S\n]+/gm, '- ')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .trim();
}

/* -- end message formatting ------------------------------------------------- */

/** Copy a reply as the words to send — Markdown stripped, not pasted. */
function copyReplyButton(markdown) {
  const text = messagePlainText(markdown);
  if (text === '') return null;

  const button = el('button', { class: 'msg-copy', type: 'button', title: 'Copy these words' }, 'Copy');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Select it by hand';
    }
    setTimeout(() => {
      button.textContent = 'Copy';
    }, 1800);
  });
  return button;
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
    canWrite()
      ? el('div', { class: 'form-actions' }, progress, save)
      : el(
          'div',
          { class: 'form-actions' },
          progress,
          el('span', { class: 'small' }, 'Read-only: ask the agency to change anything here.'),
        ),
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

  // A landlord reads these fields; the inputs are refused by the server anyway,
  // so they are shown disabled rather than pretending to accept a change.
  const common = canWrite()
    ? {
        id: `field-${field.key}`,
        'data-field': field.key,
        onInput: track,
        onChange: track,
      }
    : {
        id: `field-${field.key}`,
        'data-field': field.key,
        disabled: true,
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
        canWrite()
          ? el(
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
            )
          : null,
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
              ? el(
                  'textarea',
                  { 'data-person-key': child.key, disabled: !canWrite(), ...(canWrite() ? { onInput: markPeopleDirty } : {}) },
                  person[child.key] ?? '',
                )
              : el('input', {
                  type: child.type === 'date' ? 'date' : 'text',
                  'data-person-key': child.key,
                  value: person[child.key] ?? '',
                  placeholder: child.placeholder || '',
                  disabled: !canWrite(),
                  ...(canWrite() ? { onInput: markPeopleDirty } : {}),
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
    canWrite()
      ? el(
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
        )
      : null,
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

/**
 * The question the app should have asked at the start: do you already have your
 * own versions of these documents? An agent who has never opened the back office
 * will not go looking there on the off chance, so it is asked here.
 */
function customSection(pack) {
  const templates = state.customTemplates ?? [];

  const uploadButton = (label) =>
    el(
      'button',
      { class: 'btn btn-sm btn-primary', type: 'button', onClick: () => void openOurDocuments() },
      label,
    );

  if (templates.length === 0) {
    return el(
      'div',
      {},
      el('hr', { class: 'sep' }),
      el('h3', { style: { fontSize: '.95rem', marginBottom: '.2rem' } }, 'Do you already have your own versions?'),
      el(
        'p',
        { class: 'small' },
        'If you send tenants your own agreement, inventory report or notice, upload it once. From then on, every pack is produced in your layout and your wording, with the blank spaces filled in from the details you enter here — nothing retyped, nothing reformatted. If you would rather not, the documents above are ready to use as they are.',
      ),
      el(
        'div',
        { class: 'form-actions' },
        el('span', { class: 'small' }, 'Word files (.docx), one per document'),
        uploadButton('Upload our documents'),
      ),
    );
  }

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
      'Filled from the same details, in your own layout. Manage or add to these in Back office → Our documents.',
    ),
    el('div', { class: 'generated-list mt' }, ...items),
    el('div', { class: 'form-actions' }, el('span', { class: 'small' }, `${templates.length} uploaded`), uploadButton('Add another')),
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
  const { pack, timeline, events, creator } = state.detail;
  const audit = events ?? [];
  const computed = timeline ?? [];

  // Once a pack has been touched since accounts existed, the audit trail is the
  // history: it knows who. Older packs fall back to what the app can infer.
  const usingAudit = audit.length > 0;

  const rows = usingAudit
    ? audit.map((event) =>
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
            el('strong', {}, eventWords(event.kind)),
            el(
              'span',
              { class: 'small' },
              `${event.actorName === '' ? 'System' : event.actorName}${event.detail === '' ? '' : ` · ${event.detail}`}`,
            ),
          ),
        ),
      )
    : computed.map((event) =>
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
              `${event.kind}${event.detail === '' ? '' : ` · ${event.detail}`}`,
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
        el('h3', { style: { fontSize: '.95rem' } }, 'What happened, and who did it'),
        el(
          'p',
          { class: 'small' },
          usingAudit
            ? `Everything recorded for this tenancy, newest first${creator === null ? '' : ` · opened by ${creator.name}`}.`
            : 'This pack was opened before accounts existed, so the app can only show what happened, not who did it.',
        ),
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
    rows.length === 0
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

/* -------------------------------------------------------------- guidance --- */

/**
 * The start of the Assistant: the next few things worth doing, ranked by the pack.
 *
 * The order and the ticks both come from the server (`/guidance`), which reads the pack
 * itself. Nothing here decides that a step is finished — the model least of all.
 */
/** Where the guide lives: its own dock, above the transcript, never inside it. */
function drawGuidanceDock(packId, dock) {
  const said = (state.chat.get(packId) ?? []).length > 0;
  if ((state.guide === null || state.guide === undefined) && said) {
    // Mid-conversation with no guide: stay out of the way.
    dock.replaceChildren();
    return;
  }
  if (state.guide === null || state.guide === undefined) {
    dock.replaceChildren(el('div', { class: 'guide-start' }, el('p', { class: 'small' }, 'Working out where this pack stands…')));
  }
  void redrawGuidance(packId, dock);
}

/** The guidance for a pack, fetched once per pack and refreshed after an action. */
async function guidanceFor(packId) {
  if (state.guidance !== null && state.guidanceFor === packId) return state.guidance;
  const data = await api(`/api/packs/${packId}/guidance`);
  state.guidance = data;
  state.guidanceFor = packId;
  return data;
}

async function redrawGuidance(packId, wrap) {
  let data;
  try {
    data = await guidanceFor(packId);
  } catch (error) {
    wrap.replaceChildren(el('div', { class: 'guide-start' }, el('p', { class: 'small' }, `I could not read this pack: ${error.message}`)));
    return;
  }

  const guideId = state.guide === null || state.guide === undefined ? null : state.guide;
  const chosen = guideId === null ? null : data.options.find((option) => option.id === guideId);
  const guide = chosen ?? (guideId === null ? data.options.find((option) => data.resume !== null && option.id === data.resume.guideId) ?? null : null);
  if (guide !== null && state.guide === null) state.guide = guide.id;

  if (guide === null && (state.chat.get(packId) ?? []).length > 0) {
    wrap.replaceChildren();
    return;
  }

  const heading =
    data.landlord === true
      ? 'This tenancy is yours to read. What would you like to do?'
      : guide !== null
        ? guide.title
        : 'What would you like to work on?';

  const intro = el(
    'div',
    { class: 'guide-intro' },
    el('p', { class: 'guide-hello' }, heading),
    el(
      'p',
      { class: 'small' },
      data.landlord === true
        ? 'Your access is read-only, so these are the things you can do here.'
        : 'Pick one and I will take you through it — or just describe what you want in the box below.',
    ),
  );

  // A guide under way shows its steps; otherwise, the menu.
  const ready = data.options.filter((option) => option.applicable !== false);
  const later = data.options.filter((option) => option.applicable === false);
  const suggestedId = ready.length > 0 ? ready[0].id : null;

  const body =
    guide === null || data.options.length === 0
      ? el(
          'div',
          {},
          el(
            'div',
            { class: 'guide-cards' },
            ...ready.map((option) =>
              guideCard(option, packId, {
                suggested: option.id === suggestedId,
                isResume: data.resume !== null && data.resume.guideId === option.id,
              }),
            ),
          ),
          later.length === 0
            ? null
            : el(
                'div',
                { class: 'guide-later' },
                el('p', { class: 'small' }, 'Later in this tenancy'),
                el(
                  'div',
                  { class: 'guide-cards' },
                  ...later.map((option) => guideCard(option, packId, { later: true })),
                ),
              ),
        )
      : el(
          'div',
          {},
          ready.length > 1
            ? el(
                'div',
                { class: 'guide-cards guide-cards-slim' },
                ...ready
                  .filter((option) => option.id !== guide.id)
                  .map((option) => guideCard(option, packId, { slim: true })),
              )
            : null,
          guideRail(guide, packId),
          later.length === 0
            ? null
            : el(
                'div',
                { class: 'guide-later' },
                el('p', { class: 'small' }, 'Later in this tenancy'),
                el('div', { class: 'guide-cards guide-cards-slim' }, ...later.map((option) => guideCard(option, packId, { later: true, slim: true }))),
              ),
        );

  wrap.replaceChildren(intro, body);
}

function guideCard(option, packId, options = {}) {
  const { slim = false, later = false, suggested = false, isResume = false } = options;
  const remaining = option.steps.length - option.at;
  return el(
    'button',
    {
      class: `guide-card${slim ? ' is-slim' : ''}${later ? ' is-later' : ''}${suggested ? ' is-suggested' : ''}`,
      type: 'button',
      onClick: async () => {
        state.guide = option.id;
        state.guideSkipped = [];
        await renderMain();
        requestAnimationFrame(() => $('#guide-primary')?.focus());
      },
    },
    el(
      'span',
      { class: 'guide-card-head' },
      el(
        'strong',
        {},
        option.title,
        suggested ? el('span', { class: 'guide-suggested-tag' }, 'suggested') : null,
        isResume && !option.complete && option.at > 0 ? el('span', { class: 'guide-resume-tag' }, 'continue') : null,
      ),
      el('span', { class: 'guide-arrow', 'aria-hidden': 'true' }, '→'),
    ),
    el('span', { class: 'guide-why' }, later ? option.later : option.why),
    el(
      'span',
      { class: 'guide-meta' },
      later ? `starts at: ${option.steps[0]?.title ?? ''}` : option.complete ? 'done' : `${remaining} step${remaining === 1 ? '' : 's'}`,
      !later && option.at > 0 ? ` · ${option.at} done` : '',
    ),
  );
}

/** The steps, with what is finished ticked by the server and one action at a time. */
function guideRail(guide, packId) {
  // The app cannot see a download, so the person who took the file ticks that one.
  const skipped = state.guideSkipped ?? [];
  const steps0 = guide.steps.map((step) => {
    const downloaded = step.id === 'download' && state.guideDownloaded === true;
    return { ...step, done: step.done || downloaded, skipped: !step.done && !downloaded && skipped.includes(step.id) };
  });
  // A skipped step is navigation, not progress: it is passed over, never ticked.
  const at = steps0.findIndex((step) => !step.done && !step.skipped);
  const current = at === -1 ? undefined : steps0[at];
  guide = { ...guide, steps: steps0, at: at === -1 ? steps0.length : at };

  const steps = guide.steps.map((step, index) =>
    el(
      'div',
      {
        class: `guide-step${step.done ? ' is-done' : ''}${index === guide.at ? ' is-current' : ''}${step.skipped ? ' is-skipped' : ''}`,
        role: 'listitem',
        'aria-current': index === guide.at ? 'step' : null,
      },
      el('span', { class: 'guide-tick', 'aria-hidden': 'true' }, step.done ? '✓' : step.skipped ? '·' : String(index + 1)),
      el(
        'div',
        { class: 'guide-step-text' },
        el('strong', {}, step.title, step.skipped ? el('span', { class: 'guide-skipped-tag' }, 'skipped') : null),
        el('span', { class: 'small' }, step.what),
      ),
    ),
  );

  const actions = el('div', { class: 'guide-actions' });

  if (current === undefined) {
    const next = guide.then === null || guide.then === undefined
      ? null
      : (state.guidance?.options ?? []).find((option) => option.id === guide.then) ?? null;
    actions.append(
      el('span', { class: 'small' }, 'That is everything for this guide.'),
      next === null
        ? null
        : el(
            'button',
            {
              class: 'btn btn-primary btn-sm',
              type: 'button',
              onClick: async () => {
                state.guide = next.id;
                state.guideSkipped = [];
                await renderMain();
              },
            },
            `Carry on: ${next.title}`,
          ),
    );
  } else {
    actions.append(
      el(
        'button',
        {
          id: 'guide-primary',
          class: 'btn btn-primary btn-sm',
          type: 'button',
          onClick: () => void guideDo(packId, current),
        },
        guideActionLabel(current),
      ),
      el(
        'button',
        {
          class: 'btn btn-sm',
          type: 'button',
          title: 'Move on without doing this one. It will not be ticked.',
          onClick: async () => {
            state.guideSkipped = [...(state.guideSkipped ?? []), current.id];
            await renderMain();
          },
        },
        'Skip this step',
      ),
      el(
        'button',
        {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          title: 'Leave this guide and use the tabs instead',
          onClick: async () => {
            state.guide = null;
            state.guideSkipped = [];
            await renderMain();
          },
        },
        'I’ll do it myself',
      ),
    );
    if (current.where !== null) {
      actions.append(el('span', { class: 'small' }, `Or do it in ${current.where}.`));
    }
  }

  return el(
    'div',
    { class: 'guide-rail', role: 'list', 'aria-label': `Steps in ${guide.title}` },
    ...steps,
    actions,
    el('div', { class: 'guide-output', id: 'guide-output', 'aria-live': 'polite' }),
  );
}

const guideActionLabel = (step) => {
  if (step.id === 'paste') return 'Paste it below';
  if (step.id === 'message') return 'Draft it for me';
  if (step.id === 'generate') return 'Produce them now';
  if (step.id === 'checks' || step.id === 'outstanding') return 'Run the checks';
  if (step.id === 'download') return 'Download the zip';
  if (step.id === 'upload' || step.id === 'map') return 'Open our documents';
  if (step.id === 'fill') return 'Open the documents';
  return 'Show me';
};

/** Do the thing the current step is about, then ask the server again. */
async function guideDo(packId, step) {
  const output = $('#guide-output');
  const say = (node) => {
    if (output !== null) output.replaceChildren(node);
  };

  try {
    if (step.id === 'paste') {
      const input = $('#composer-input');
      if (input !== null) input.focus();
      say(el('p', { class: 'small' }, 'Paste it into the box below and press Send — I will read it and tell you what I found.'));
      return;
    }

    if (step.id === 'message') {
      await sendMessage('Draft the covering email and a short WhatsApp message for the tenant.');
      return;
    }

    if (step.id === 'download') {
      window.location.href = `/api/packs/${packId}/bundle.zip`;
      say(el('p', { class: 'small' }, 'That is the zip — every document, plus the summary sheet.'));
      return;
    }

    if (step.id === 'upload' || step.id === 'map' || step.id === 'fill') {
      await renderMain().then(() => {});
      if (step.id === 'fill') {
        state.tab = 'documents';
        await renderMain();
      } else {
        await openOurDocuments();
      }
      return;
    }

    if (step.id === 'checks' || step.id === 'outstanding') {
      const result = await api(`/api/packs/${packId}/checks`, { method: 'POST', body: '{}' });
      const findings = (result.findings ?? []).filter((finding) => finding.severity !== 'info');
      say(
        el(
          'div',
          {},
          el('p', { class: 'small' }, findings.length === 0 ? 'Nothing flagged.' : `${findings.length} to look at:`),
          ...findings.slice(0, 6).map((finding) =>
            el(
              'div',
              { class: 'guide-finding' },
              el('span', {}, `• ${finding.title}`),
              el(
                'button',
                { class: 'btn btn-sm btn-ghost', type: 'button', onClick: () => checkFinding(finding, finding.severity) },
                'Why?',
              ),
            ),
          ),
          canWrite() && findings.length > 0
            ? el(
                'button',
                {
                  class: 'btn btn-sm',
                  type: 'button',
                  style: { marginTop: '.35rem' },
                  onClick: async () => {
                    state.guide = 'fix-checks';
                    state.guideSkipped = [];
                    await renderMain();
                  },
                },
                'Walk me through the fixes',
              )
            : null,
        ),
      );
      await reloadGuidance(packId);
      return;
    }

    if (step.id === 'generate') {
      const ids = state.detail?.suggested ?? [];
      if (ids.length === 0) {
        say(el('p', { class: 'small' }, 'No documents are suggested for this pack yet.'));
        return;
      }
      const generated = await api(`/api/packs/${packId}/generate`, {
        method: 'POST',
        body: JSON.stringify({ templateIds: ids }),
      });
      if (generated.needsConfirmation === true) {
        // The same question the Documents tab asks. The guide does not get to skip it.
        askToContinue(generated, async () => {
          await api(`/api/packs/${packId}/generate`, {
            method: 'POST',
            body: JSON.stringify({ templateIds: ids, confirm: true }),
          });
          state.detail = await api(`/api/packs/${packId}`);
          await refreshPacks();
          await reloadGuidance(packId);
          await renderMain();
        });
        return;
      }
      state.detail = generated.pack ?? state.detail;
      await refreshPacks();
      await reloadGuidance(packId);
      await renderMain();
      return;
    }

    if (step.id === 'essentials' || step.id === 'review') {
      state.tab = 'details';
      await renderMain();
      return;
    }
  } catch (error) {
    say(el('p', { class: 'small' }, error.message));
  }
}

/** Ask the server where the pack stands now, and redraw the rail from its answer. */
async function reloadGuidance(packId) {
  try {
    state.guidance = await api(`/api/packs/${packId}/guidance`);
    state.guidanceFor = packId;
  } catch {
    // The rail keeps whatever it had; the ticks simply will not move.
  }
}

/* -------------------------------------------------------------- feedback --- */

/**
 * The FEEDBACK button.
 *
 * Everybody with an account gets it, because a landlord's confusion is exactly what
 * this is for. What it collects is addressed to the product's owner, never to the
 * agency — so the panel says so, and the queue behind it is the operator's alone.
 *
 * The conversation is optional: if the assistant is off or unreachable, the same panel
 * becomes a plain form that files the same record.
 */
const feedbackState = {
  open: false,
  busy: false,
  messages: [], // { role: 'tester' | 'agent', text }
  proposal: null,
  unavailable: false,
  mine: [],
};

const KIND_WORDS = {
  improvement: 'Improvement',
  new_feature: 'New feature',
  bug: 'Something broken',
  confusion: 'Hard to find',
  praise: 'Praise',
};

/** Where the person was standing when they pressed the button. */
function feedbackContext() {
  const screen = state.view === 'tenancy' ? (state.tab ?? '') : state.view;
  return {
    screen,
    packReference: state.detail?.pack?.reference ?? '',
  };
}

function renderFeedbackPill() {
  const root = $('#feedback-root');
  if (state.me === null) {
    root.replaceChildren();
    return;
  }

  const button = el(
    'button',
    {
      class: `feedback-pill${feedbackState.open ? ' is-open' : ''}`,
      type: 'button',
      title: 'Tell us what to change — this goes to the TenancyDesk team',
      onClick: () => {
        feedbackState.open = !feedbackState.open;
        drawFeedback();
      },
    },
    feedbackState.open ? 'Close' : 'Feedback',
  );

  root.replaceChildren(el('div', { class: 'feedback-dock' }, feedbackState.open ? feedbackPanel() : null, button));
}

function drawFeedback() {
  renderFeedbackPill();
  const input = $('#feedback-input');
  if (input !== null) input.focus();
}

function feedbackMessages() {
  const log = el('div', { class: 'feedback-log' });
  if (feedbackState.messages.length === 0) {
    log.append(
      el('div', { class: 'feedback-msg agent' }, el('p', {}, 'What could be better? Say it however you like — a wish, a frustration, a thing that took too long.')),
      el('p', { class: 'small' }, 'This reaches the team that builds TenancyDesk. It does not go to your agency.'),
    );
    return log;
  }

  for (const message of feedbackState.messages) {
    log.append(
      el(
        'div',
        { class: `feedback-msg ${message.role === 'agent' ? 'agent' : 'tester'}` },
        ...renderMessageText(message.text, { markdown: message.role === 'agent' }),
      ),
    );
  }

  if (feedbackState.busy) log.append(el('div', { class: 'small' }, 'thinking…'));
  return log;
}

function feedbackProposalCard() {
  const proposal = feedbackState.proposal;
  if (proposal === null) return null;

  return el(
    'div',
    { class: 'feedback-proposal' },
    el('div', { class: 'small' }, `I will file this as a ${KIND_WORDS[proposal.kind] ?? proposal.kind}`),
    el('strong', {}, proposal.title),
    el('p', { class: 'small' }, proposal.summary),
    el(
      'div',
      { class: 'form-actions' },
      el('span', { class: 'small' }, 'Filed under your name'),
      el(
        'div',
        { style: { display: 'flex', gap: '.4rem' } },
        el(
          'button',
          { class: 'btn btn-sm', type: 'button', onClick: () => fileProposal() },
          'Yes, file it',
        ),
        el(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            type: 'button',
            onClick: () => {
              feedbackState.proposal = null;
              const input = $('#feedback-input');
              if (input !== null) input.focus();
              drawFeedback();
            },
          },
          'Change something',
        ),
      ),
    ),
  );
}

function feedbackForm() {
  const what = el('textarea', { id: 'feedback-what', rows: 3, placeholder: 'What were you trying to do, and what would be better?' });
  const submit = el(
    'button',
    {
      class: 'btn btn-primary btn-sm',
      type: 'button',
      onClick: async () => {
        const text = what.value.trim();
        if (text === '') {
          toast('Tell us what to change first.', true);
          return;
        }
        submit.disabled = true;
        try {
          const context = feedbackContext();
          await api('/api/feedback', {
            method: 'POST',
            body: JSON.stringify({
              title: text.split('\n')[0].slice(0, 80),
              summary: text,
              kind: 'improvement',
              area: context.screen === 'tenancy' ? 'other' : (context.screen || 'other'),
              screen: context.screen,
              packReference: context.packReference,
              messages: [{ role: 'tester', text }],
            }),
          });
          toast('Filed. The team will see it.');
          feedbackState.open = false;
          await loadMyFeedback();
          drawFeedback();
        } catch (error) {
          toast(error.message, true);
          submit.disabled = false;
        }
      },
    },
    'Send it',
  );

  return el(
    'div',
    { class: 'feedback-form' },
    el('p', { class: 'small' }, 'The assistant is not available, so this is a plain note — it reaches the same list.'),
    what,
    el('div', { class: 'form-actions' }, el('span', { class: 'small' }, ''), submit),
  );
}

function feedbackMineList() {
  if (feedbackState.mine.length === 0) return null;
  return el(
    'div',
    { class: 'feedback-mine' },
    el('div', { class: 'small' }, 'What you have sent'),
    ...feedbackState.mine.slice(0, 5).map((item) =>
      el(
        'div',
        { class: 'feedback-mine-row' },
        el('strong', {}, item.title),
        el('span', { class: `badge status-${item.status}` }, item.statusWords),
        item.publicNote === '' ? null : el('p', { class: 'small' }, item.publicNote),
      ),
    ),
  );
}

function feedbackPanel() {
  const input = el('textarea', {
    id: 'feedback-input',
    rows: 2,
    placeholder: 'Type it however you like…',
    onKeydown: (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void sendFeedbackMessage();
      }
    },
  });

  return el(
    'div',
    { class: 'feedback-panel' },
    el(
      'div',
      { class: 'feedback-panel-head' },
      el('strong', {}, 'Feedback'),
      el('span', { class: 'small' }, 'Goes to the TenancyDesk team, not your agency'),
    ),
    feedbackMessages(),
    feedbackProposalCard(),
    feedbackState.unavailable
      ? feedbackForm()
      : el(
          'div',
          { class: 'feedback-composer' },
          input,
          el(
            'button',
            {
              class: 'btn btn-primary btn-sm',
              type: 'button',
              onClick: () => void sendFeedbackMessage(),
            },
            'Send',
          ),
        ),
    feedbackMineList(),
  );
}

async function loadMyFeedback() {
  try {
    const result = await api('/api/feedback/mine');
    feedbackState.mine = result.items ?? [];
  } catch {
    feedbackState.mine = [];
  }
}

async function sendFeedbackMessage() {
  const input = $('#feedback-input');
  if (input === null) return;
  const text = input.value.trim();
  if (text === '' || feedbackState.busy) return;

  feedbackState.messages.push({ role: 'tester', text });
  feedbackState.busy = true;
  feedbackState.proposal = null;
  input.value = '';
  drawFeedback();

  try {
    const result = await api('/api/feedback/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: feedbackState.messages, context: feedbackContext() }),
    });

    if (result.unavailable === true) {
      // Never lose what they typed: keep it in the form and let them send it plainly.
      feedbackState.unavailable = true;
      feedbackState.busy = false;
      drawFeedback();
      const box = $('#feedback-what');
      if (box !== null) box.value = feedbackState.messages.map((message) => message.text).join('\n\n');
      return;
    }

    if (typeof result.reply === 'string' && result.reply.trim() !== '') {
      feedbackState.messages.push({ role: 'agent', text: result.reply });
    }
    feedbackState.proposal = result.proposal ?? null;
  } catch (error) {
    toast(error.message, true);
  } finally {
    feedbackState.busy = false;
    drawFeedback();
  }
}

async function fileProposal() {
  const proposal = feedbackState.proposal;
  if (proposal === null) return;
  const context = feedbackContext();
  feedbackState.busy = true;
  drawFeedback();

  try {
    await api('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({
        ...proposal,
        screen: context.screen,
        packReference: context.packReference,
        messages: feedbackState.messages,
      }),
    });
    toast('Filed. The team will read it — thank you.');
    feedbackState.open = false;
    feedbackState.messages = [];
    feedbackState.proposal = null;
    await loadMyFeedback();
  } catch (error) {
    toast(error.message, true);
  } finally {
    feedbackState.busy = false;
    drawFeedback();
  }
}

/* ------------------------------------------------------ feedback, operator --- */

/** The queue: the operator's side, and nobody else's. Its own view, not a tab. */
function renderFeedbackQueue(main) {
  const header = el(
    'div',
    { class: 'pack-head' },
    el(
      'div',
      { class: 'pack-title' },
      el('h2', {}, 'Feedback'),
      el(
        'div',
        { class: 'pack-where' },
        'What testers have asked for. Handled items are removed the moment you mark them done.',
      ),
    ),
    el(
      'div',
      { class: 'pack-actions' },
      el('a', { class: 'btn', href: '/api/feedback/export?private=1' }, 'Export as Markdown'),
      el(
        'button',
        { class: 'btn', type: 'button', onClick: () => { state.view = 'tenancy'; renderMain(); } },
        'Back to tenancies',
      ),
    ),
  );

  const body = el('div', { class: 'bo-grid' }, el('p', { class: 'small' }, 'Loading feedback…'));
  main.replaceChildren(header, body);

  void (async () => {
    let data;
    try {
      data = await api('/api/feedback/queue');
    } catch (error) {
      // Not a dead end: say who reads this list, who you are, and what changes it.
      body.replaceChildren(
        el(
          'div',
          { class: 'notice notice-err' },
          el('p', {}, error.message),
          state.me?.isOperator !== true && isOwner()
            ? el(
                'p',
                { class: 'small' },
                'The queue belongs to the installation’s product owner, which is not the same as being the agency’s owner. Mark your account in Back office → People & access, or add your address to OPERATOR_EMAILS and restart.',
              )
            : null,
          isOwner()
            ? el(
                'button',
                { class: 'btn btn-sm', type: 'button', onClick: () => { state.view = 'tenancy'; renderMain(); } },
                'Back to the app',
              )
            : null,
        ),
      );
      return;
    }

    const counts = data.counts ?? {};
    const items = data.items ?? [];
    const refresh = () => renderFeedbackQueue($('#main'));

    const row = (item) => {
      const status = el(
        'select',
        {},
        ...(data.statuses ?? [])
          .filter((entry) => entry.value !== 'done')
          .map((entry) => el('option', { value: entry.value, selected: entry.value === item.status }, entry.label)),
      );
      const note = el('input', { type: 'text', placeholder: 'Note to yourself', value: item.operatorNote ?? '' });
      const publicNote = el('input', { type: 'text', placeholder: 'What to tell them (they see this)', value: item.publicNote ?? '' });

      return el(
        'div',
        { class: 'bo-row feedback-row' },
        el(
          'div',
          { class: 'bo-what' },
          el(
            'strong',
            {},
            item.title,
            item.clusterCount > 1 ? el('span', { class: 'badge badge-ok' }, `asked ${item.clusterCount} times`) : null,
            item.previousAsks > 0
              ? el('span', { class: 'badge' }, `handled ${item.previousAsks} time${item.previousAsks === 1 ? '' : 's'} before`)
              : null,
            item.needsReview.length > 0 ? el('span', { class: 'badge badge-warn' }, 'needs a look') : null,
          ),
          el(
            'span',
            {},
            `${KIND_WORDS[item.kind] ?? item.kind} · ${item.userName} (${item.role})${item.screen === '' ? '' : ` · ${item.screen}`} · ${new Date(item.createdAt).toLocaleString('en-GB')}`,
          ),
          el('p', { class: 'small' }, item.summary),
          item.needsReview.length > 0
            ? el('p', { class: 'small', style: { color: '#8a5a12' } }, `Flagged: ${item.needsReview.join('; ')}`)
            : null,
          item.publicNote === '' ? null : el('p', { class: 'small' }, `You told them: ${item.publicNote}`),
        ),
        el(
          'div',
          { class: 'feedback-controls' },
          status,
          note,
          publicNote,
          el(
            'div',
            { style: { display: 'flex', gap: '.35rem' } },
            el(
              'button',
              {
                class: 'btn btn-sm',
                type: 'button',
                onClick: async () => {
                  try {
                    await api(`/api/feedback/${item.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({
                        status: status.value,
                        operatorNote: note.value,
                        publicNote: publicNote.value,
                      }),
                    });
                    toast('Saved.');
                    refresh();
                  } catch (error) {
                    toast(error.message, true);
                  }
                },
              },
              'Save',
            ),
            el(
              'button',
              {
                class: 'btn btn-sm btn-primary',
                type: 'button',
                title: 'Handled — this removes the record',
                onClick: async () => {
                  const sure = window.confirm(
                    `Mark “${item.title}” done?\n\nIt is removed from this list straight away, with the tester's words and who sent them. Only an anonymous count of how often this is asked for is kept.`,
                  );
                  if (!sure) return;
                  try {
                    const result = await api(`/api/feedback/${item.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ status: 'done' }),
                    });
                    toast(result?.message ?? 'Done — removed.');
                    refresh();
                  } catch (error) {
                    toast(error.message, true);
                  }
                },
              },
              'Done',
            ),
          ),
        ),
      );
    };

    const open = items.filter((item) => item.status !== 'declined');
    const setAside = items.filter((item) => item.status === 'declined');

    const sections = [
      el(
        'div',
        { class: 'bo-section' },
        el('h3', {}, `Waiting · ${open.length}`),
        el(
          'p',
          { class: 'small' },
          `${counts.new ?? 0} not looked at · ${counts.triaged ?? 0} being looked at · ${counts.planned ?? 0} on the list`,
        ),
        open.length === 0
          ? el('div', { class: 'notice notice-info' }, 'Nothing waiting. Everything you have dealt with has been cleared.')
          : el('div', {}, ...open.map(row)),
      ),
    ];

    if (setAside.length > 0) {
      sections.push(
        el(
          'div',
          { class: 'bo-section' },
          el('h3', {}, `Set aside · ${setAside.length}`),
          el('p', { class: 'small' }, 'Kept so the reason is not lost. Mark one done to remove it as well.'),
          el('div', {}, ...setAside.map(row)),
        ),
      );
    }

    body.replaceChildren(
      ...sections,
      el(
        'p',
        { class: 'small' },
        'Only the product owner sees this list. Marking something done deletes it — the tester’s words, the conversation and who sent them. What survives is an anonymous count, so “asked for four times” still shows on the next one.',
      ),
    );
  })();
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

/**
 * The back office, grouped by what a person is trying to do — records, people, looking
 * after the installation — rather than one flat row of nine that has to be read to be
 * understood. Overview stands alone; it is where you land.
 */
const BO_GROUPS = [
  { id: 'overview', label: null },
  { id: 'records', label: 'Records' },
  { id: 'people', label: 'People' },
  { id: 'care', label: 'Care' },
  { id: 'product', label: 'Product' },
];

const BO_TABS = [
  ['overview', 'Overview', ['owner', 'agent'], false, 'overview'],
  ['properties', 'Properties & rooms', ['owner', 'agent'], false, 'records'],
  ['people', 'Landlords & tenants', ['owner', 'agent'], false, 'records'],
  ['documents', 'Our documents', ['owner', 'agent'], false, 'records'],
  ['access', 'People & access', ['owner'], false, 'people'],
  ['health', 'Health & backup', ['owner'], false, 'care'],
  ['tidy', 'Tidy up', ['owner'], false, 'care'],
  ['settings', 'Agency settings', ['owner'], false, 'care'],
  // The feedback queue is the product owner's, not the agency's: `operatorOnly`.
  ['feedback', 'Feedback', ['owner'], true, 'product'],
];

/** The tabs this person may see, grouped, in order. */
function backOfficeTabGroups() {
  const allowed = BO_TABS.filter(
    ([, , roles, operatorOnly]) =>
      roles.includes(myRole()) && (operatorOnly !== true || state.me?.isOperator === true),
  );

  return BO_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    tabs: allowed.filter(([, , , , groupId]) => groupId === group.id),
  })).filter((group) => group.tabs.length > 0);
}

/** Flat list of what this person may see — used to decide the current tab. */
function backOfficeTabs() {
  return backOfficeTabGroups().flatMap((group) => group.tabs);
}

/** Load the agency's own records, uploads and health figures. */
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

/**
 * Open the back office, optionally on a named tab. Nothing is loaded until it is
 * needed, so the page shows its heading first rather than an empty screen.
 */
async function openBackOffice(tab) {
  if (typeof tab === 'string' && tab !== '') state.boTab = tab;
  state.view = 'backoffice';
  renderMain();
  if (state.backOffice === null || state.backOffice === undefined) {
    await loadBackOffice();
    renderMain();
  }
}

/** The place an agent uploads their own agreement, report or notice. */
async function openOurDocuments() {
  try {
    await openBackOffice('documents');
  } catch (error) {
    toast(error.message, true);
  }
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

  const allowed = backOfficeTabs();
  const current = allowed.some(([id]) => id === state.boTab) ? state.boTab : (allowed[0]?.[0] ?? 'settings');

  const tabButton = ([id, label]) =>
    el(
      'button',
      {
        class: `btn btn-sm${current === id ? ' is-active' : ''}`,
        type: 'button',
        'aria-current': current === id ? 'page' : null,
        onClick: () => {
          state.boTab = id;
          renderMain();
        },
      },
      label,
    );

  const tabs = el(
    'div',
    { class: 'bo-links', role: 'navigation', 'aria-label': 'Back office sections' },
    ...backOfficeTabGroups().map((group) =>
      el(
        'div',
        { class: 'bo-group' },
        group.label === null ? null : el('span', { class: 'bo-group-label' }, group.label),
        el('div', { class: 'bo-group-buttons' }, ...group.tabs.map(tabButton)),
      ),
    ),
  );

  if (data === null || data === undefined) {
    main.replaceChildren(header, el('p', { class: 'small' }, 'Loading…'));
    return;
  }

  let body;
  if (current === 'overview') body = renderOverviewSection();
  else if (current === 'properties') body = renderPropertiesSection(data);
  else if (current === 'people') body = renderPeopleSection(data);
  else if (current === 'documents') body = renderOurDocumentsSection();
  else if (current === 'access') body = renderAccessSection();
  else if (current === 'feedback') {
    state.view = 'feedback';
    renderMain();
    return;
  }
  else if (current === 'health') body = renderHealthSection();
  else if (current === 'tidy') body = renderMigrationSection(data);
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

  /**
   * A person's details are not a flat key: they live in the `tenants` array, at
   * `tenants[0].full_name`. Offering only flat keys meant the one value every
   * agreement needs — the tenant's name — could not be mapped at all, so the first two
   * tenants are offered here, expanded.
   */
  const optionsFor = (field) => {
    if (field.type !== 'people') {
      return [el('option', { value: field.key, selected: value === field.key }, field.label)];
    }
    const children = Array.isArray(field.children) ? field.children : [];
    return [0, 1].flatMap((index) =>
      children.map((child) =>
        el(
          'option',
          {
            value: `${field.key}[${index}].${child.key}`,
            selected: value === `${field.key}[${index}].${child.key}`,
          },
          `${child.label}${index === 0 ? ' (first tenant)' : ` (tenant ${index + 1})`}`,
        ),
      ),
    );
  };

  const selects = el(
    'select',
    { class: 'field-map' },
    el('option', { value: '' }, '— not used —'),
    ...[...groups.entries()].map(([groupId, fields]) => {
      const label = state.groups.find((group) => group.id === groupId)?.title ?? groupId;
      return el('optgroup', { label }, ...fields.flatMap(optionsFor));
    }),
  );
  selects.addEventListener('change', () => onChange(selects.value));
  return selects;
}

/* ---------------------------------------------------------------- overview --- */

/**
 * The first thing the back office says: the state of things, and what to do about it.
 *
 * Every number here is a link to the screen that changes it. A dashboard that only
 * reports is decoration.
 */
function renderOverviewSection() {
  const box = el('div', { class: 'bo-grid' }, el('p', { class: 'small' }, 'Looking at where things stand…'));

  const goTab = (tab) => {
    state.view = 'backoffice';
    state.boTab = tab;
    renderMain();
  };

  void (async () => {
    let data;
    try {
      data = await api('/api/overview');
    } catch (error) {
      box.replaceChildren(el('div', { class: 'notice notice-err' }, error.message));
      return;
    }

    const bytes = (value) => {
      if (typeof value !== 'number') return '—';
      const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
      let size = value;
      let unit = 0;
      while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
      }
      return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
    };

    const figure = (label, value) =>
      el('div', { class: 'ov-figure' }, el('strong', {}, String(value)), el('span', {}, label));
    const link = (label, onClick) => el('button', { class: 'btn btn-sm', type: 'button', onClick }, label);
    const card = (title, children, action) =>
      el(
        'div',
        { class: 'bo-section ov-card' },
        el('div', { class: 'ov-card-head' }, el('h3', {}, title), action ?? null),
        ...children,
      );
    const flag = (text, action) =>
      el('div', { class: 'ov-flag' }, el('span', {}, text), action ?? null);

    const lastBackup =
      data.care.lastBackupAt === null
        ? 'never — nothing has been backed up'
        : new Date(data.care.lastBackupAt).toLocaleString('en-GB');

    const activityRows = (data.activity ?? []).slice(0, 8).map((event) =>
      el(
        'div',
        { class: 'ov-activity-row' },
        el('span', { class: 'small' }, new Date(event.at).toLocaleString('en-GB')),
        el(
          'span',
          {},
          `${event.actor === '' ? 'System' : event.actor} — ${eventWords(event.kind)}${event.detail === '' ? '' : `: ${event.detail}`}`,
        ),
      ),
    );

    const quick = el(
      'div',
      { class: 'ov-quick' },
      canWrite() ? el('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => void createPack() }, 'New tenant pack') : null,
      canWrite() ? el('button', { class: 'btn btn-sm', type: 'button', onClick: () => goTab('properties') }, 'Add a property') : null,
      canWrite() ? el('button', { class: 'btn btn-sm', type: 'button', onClick: () => void openOurDocuments() }, 'Upload our documents') : null,
      isOwner() ? el('a', { class: 'btn btn-sm', href: '/api/backup' }, 'Download a backup') : null,
    );

    box.replaceChildren(
      quick,
      el(
        'div',
        { class: 'ov-grid' },
        card(
          'Tenancies',
          [
            el(
              'div',
              { class: 'ov-figures' },
              figure('in total', data.tenancies.total),
              figure('active', data.tenancies.lifecycle.active ?? 0),
              figure('starting soon', data.tenancies.lifecycle.upcoming ?? 0),
              figure('documents', data.tenancies.documents),
            ),
            data.tenancies.withoutDocuments > 0
              ? flag(
                  `${data.tenancies.withoutDocuments} tenancy${data.tenancies.withoutDocuments === 1 ? ' has' : 'ies have'} no documents yet`,
                )
              : null,
            data.tenancies.withoutProperty > 0
              ? flag(
                  `${data.tenancies.withoutProperty} tenancy${data.tenancies.withoutProperty === 1 ? ' is' : 'ies are'} not linked to a property, so ${data.tenancies.withoutProperty === 1 ? 'it inherits' : 'they inherit'} nothing`,
                  canWrite() ? link('Tidy up', () => goTab('tidy')) : null,
                )
              : null,
          ],
          link('All tenancies', () => { state.view = 'tenancy'; renderMain(); }),
        ),
        card(
          'Deadlines',
          [
            el(
              'div',
              { class: 'ov-figures' },
              figure('past their date', data.deadlines.overdue),
              figure('due in 30 days', data.deadlines.soon),
              figure('tracked', data.deadlines.total),
            ),
            data.deadlines.overdue > 0
              ? flag(`${data.deadlines.overdue} item${data.deadlines.overdue === 1 ? ' is' : 's are'} past their date`)
              : el('p', { class: 'small' }, 'Nothing past its date.'),
          ],
          link('What’s due', () => { state.view = 'due'; renderMain(); }),
        ),
      ),
      el(
        'div',
        { class: 'ov-grid' },
        card(
          'Records',
          [
            el(
              'div',
              { class: 'ov-figures' },
              figure('landlords', data.records.landlords),
              figure('properties', data.records.properties),
              figure('rooms', data.records.rooms),
              figure('tenants', data.records.tenants),
              figure('your documents', data.records.uploads),
            ),
            data.records.properties === 0
              ? el('p', { class: 'small' }, 'Add a property once, and every tenancy at that address inherits it.')
              : null,
          ],
          canWrite() ? link('Properties & rooms', () => goTab('properties')) : null,
        ),
        card(
          'People',
          [
            el(
              'div',
              { class: 'ov-figures' },
              figure('accounts', data.people.total),
              figure('owners', data.people.owners),
              figure('agents', data.people.agents),
              figure('landlords', data.people.landlords),
            ),
            el(
              'p',
              { class: 'small' },
              data.people.operators.length === 0
                ? 'No account reads the feedback queue.'
                : `Reads the feedback queue: ${data.people.operators.join(', ')}.`,
            ),
          ],
          isOwner() ? link('People & access', () => goTab('access')) : null,
        ),
        card(
          'The installation',
          [
            el('div', { class: 'ov-figures' }, figure('database', bytes(data.care.databaseBytes)), figure('free disk', bytes(data.care.freeBytes))),
            el('p', { class: 'small' }, `Last backup: ${lastBackup}`),
            data.care.lastBackupAt === null
              ? el('p', { class: 'small' }, 'If the backup job is not running, everything lives on one disk.')
              : null,
          ],
          isOwner() ? link('Health & backup', () => goTab('health')) : null,
        ),
      ),
      data.feedback === null
        ? el('div')
        : card(
            'Feedback',
            [
              el('div', { class: 'ov-figures' }, figure('waiting for you', data.feedback.waiting)),
              el(
                'p',
                { class: 'small' },
                data.feedback.waiting === 0
                  ? 'Nothing waiting. Anything handled has been cleared.'
                  : `${data.feedback.waiting} report${data.feedback.waiting === 1 ? '' : 's'} from testers — new or being looked at.`,
              ),
            ],
            link('Read it', () => openFeedbackQueue()),
          ),
      card(
        'Recent activity',
        [
          activityRows.length === 0
            ? el('p', { class: 'small' }, 'Nothing recorded yet.')
            : el('div', { class: 'ov-activity' }, ...activityRows),
        ],
      ),
    );
  })();

  return box;
}

/* ------------------------------------------------------ people and access --- */

/** A password a person can actually type, and that nobody can guess. */
function suggestPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => 'abcdefghijkmnpqrstuvwxyz23456789'[byte % 32]).join('').slice(0, 20);
}

const ROLE_WORDS = {
  owner: 'Owner — everything, including people and settings',
  agent: 'Agent — every tenancy and record, no settings or people',
  landlord: 'Landlord — read-only, their own tenancies only',
};

const EVENT_WORDS = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.setup': 'Created the first account',
  'auth.password': 'Changed their password',
  'pack.created': 'Opened a tenancy',
  'pack.deleted': 'Deleted a tenancy',
  'fields.changed': 'Changed details',
  'documents.generated': 'Generated documents',
  'note.added': 'Added a note',
  'note.removed': 'Removed a note',
  'assistant.run': 'Used the assistant',
  'upload.added': 'Uploaded a document',
  'upload.updated': 'Changed a mapping',
  'upload.removed': 'Removed a document',
  'settings.updated': 'Changed the agency details',
  'backoffice.migrated': 'Tidied up the records',
  'user.created': 'Added somebody',
  'user.updated': 'Changed somebody’s access',
  'user.disabled': 'Switched an account off',
  'user.enabled': 'Switched an account on',
  'user.password': 'Reset a password',
  'record.landlords.created': 'Added a landlord',
  'record.properties.created': 'Added a property',
  'record.rooms.created': 'Added a room',
  'record.tenants.created': 'Added a tenant',
};

const eventWords = (kind) => EVENT_WORDS[kind] ?? kind;

function roleBadge(role) {
  return el('span', { class: `badge role-${role}` }, role === 'owner' ? 'Owner' : role === 'agent' ? 'Agent' : 'Landlord');
}

/** Set somebody's password, or generate one and show it once. */
function passwordDialog(user) {
  const close = () => $('#modal-root').replaceChildren();
  const suggestion = suggestPassword();
  const shown = el('input', { type: 'text', value: suggestion, readonly: true, class: 'mono' });
  const own = el('input', { type: 'text', placeholder: 'Or type one (at least 12 characters)' });
  const error = el('div', { class: 'notice notice-err', hidden: true });

  const set = async () => {
    const chosen = own.value.trim() === '' ? shown.value : own.value.trim();
    try {
      await api(`/api/users/${user.id}/password`, {
        method: 'POST',
        body: JSON.stringify({ password: chosen }),
      });
      close();
      toast(`Password set for ${user.name || user.email}. They have been signed out everywhere.`);
      renderMain();
    } catch (caught) {
      error.textContent = caught.message;
      error.hidden = false;
    }
  };

  $('#modal-root').replaceChildren(
    el(
      'div',
      { class: 'modal-backdrop', onClick: (event) => { if (event.target === event.currentTarget) close(); } },
      el(
        'div',
        { class: 'modal', style: { height: 'auto' } },
        el('div', { class: 'modal-head' }, el('h3', {}, `Password for ${user.name || user.email}`), el('button', { class: 'btn btn-sm', type: 'button', onClick: close }, 'Close')),
        el(
          'div',
          { class: 'modal-body' },
          el('p', { class: 'small' }, 'Generated for you — copy it before you close this. It is not stored anywhere you can read it again.'),
          error,
          el('div', { class: 'field' }, el('label', {}, 'A suggestion'), shown),
          el('div', { class: 'field' }, el('label', {}, 'Their own choice'), own),
          el(
            'div',
            { class: 'form-actions' },
            el(
              'button',
              {
                class: 'btn',
                type: 'button',
                onClick: async () => {
                  try {
                    await navigator.clipboard.writeText(shown.value);
                    toast('Copied.');
                  } catch {
                    toast('Select the text and copy it by hand.', true);
                  }
                },
              },
              'Copy',
            ),
            el('button', { class: 'btn btn-primary', type: 'button', onClick: set }, 'Set this password'),
          ),
        ),
      ),
    ),
  );
}

function renderAccessSection() {
  const box = el('div', { class: 'bo-grid' }, el('p', { class: 'small' }, 'Loading people…'));

  void (async () => {
    let data;
    let log = { events: [] };
    try {
      data = await api('/api/users');
      if (isOwner()) log = await api('/api/access/log').catch(() => ({ events: [] }));
    } catch (error) {
      box.replaceChildren(el('div', { class: 'notice notice-err' }, error.message));
      return;
    }

    const refresh = () => renderMain();

    // --- add somebody ------------------------------------------------------
    const nameInput = el('input', { type: 'text', id: 'new-user-name', placeholder: 'Ade Bello' });
    const emailInput = el('input', { type: 'email', id: 'new-user-email', placeholder: 'ade@youragency.co.uk' });
    const roleSelect = el(
      'select',
      { id: 'new-user-role' },
      ...data.roles.map((role) => el('option', { value: role, selected: role === 'agent' }, ROLE_WORDS[role])),
    );
    const landlordSelect = el(
      'select',
      { id: 'new-user-landlord' },
      el('option', { value: '' }, '— choose the landlord record —'),
      ...(data.landlords ?? []).map((landlord) => el('option', { value: landlord.id }, landlord.name)),
    );
    const landlordRow = el('div', { class: 'field', hidden: true }, el('label', {}, 'Which landlord'), landlordSelect);
    const passwordInput = el('input', { type: 'text', id: 'new-user-password', value: suggestPassword() });

    roleSelect.addEventListener('change', () => {
      landlordRow.hidden = roleSelect.value !== 'landlord';
    });
    if ((data.landlords ?? []).length === 0) {
      landlordRow.hidden = true;
    }

    const addPerson = el(
      'div',
      { class: 'bo-section' },
      el('h3', {}, 'Add somebody'),
      el(
        'p',
        { class: 'small' },
        'They sign in with their own email and password, and the History shows what each person did. Give the password to them privately — it is shown here once.',
      ),
      el(
        'div',
        { class: 'grid-2' },
        el('div', { class: 'field' }, el('label', {}, 'Their name'), nameInput),
        el('div', { class: 'field' }, el('label', {}, 'Their email'), emailInput),
      ),
      el('div', { class: 'field' }, el('label', {}, 'What they may do'), roleSelect),
      landlordRow,
      el(
        'div',
        { class: 'field' },
        el('label', {}, 'A password for them'),
        passwordInput,
        el(
          'button',
          {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            style: { marginTop: '.35rem', justifySelf: 'start' },
            onClick: () => {
              passwordInput.value = suggestPassword();
            },
          },
          'Suggest another',
        ),
      ),
      el(
        'div',
        { class: 'form-actions' },
        el('span', { class: 'small' }, 'At least 12 characters'),
        el(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            onClick: async () => {
              try {
                await api('/api/users', {
                  method: 'POST',
                  body: JSON.stringify({
                    name: nameInput.value.trim(),
                    email: emailInput.value.trim(),
                    role: roleSelect.value,
                    password: passwordInput.value,
                    landlordId: roleSelect.value === 'landlord' ? landlordSelect.value : null,
                  }),
                });
                toast(`${nameInput.value.trim() || 'They'} can sign in now. Give them the password you just set.`);
                refresh();
              } catch (error) {
                toast(error.message, true);
              }
            },
          },
          'Add them',
        ),
      ),
    );

    // --- the list ----------------------------------------------------------
    const personRow = (person) => {
      const actions = el('div', { style: { display: 'flex', gap: '.35rem', flexWrap: 'wrap' } });

      if (person.id !== state.me?.id) {
        actions.append(
          el(
            'button',
            {
              class: 'btn btn-sm',
              type: 'button',
              onClick: async () => {
                try {
                  await api(`/api/users/${person.id}/disabled`, {
                    method: 'POST',
                    body: JSON.stringify({ disabled: !person.disabled }),
                  });
                  toast(person.disabled ? 'Switched back on.' : 'Switched off, and signed out everywhere.');
                  refresh();
                } catch (error) {
                  toast(error.message, true);
                }
              },
            },
            person.disabled ? 'Switch on' : 'Switch off',
          ),
          el('button', { class: 'btn btn-sm', type: 'button', onClick: () => passwordDialog(person) }, 'Set a password'),
          el(
            'button',
            {
              class: 'btn btn-sm btn-danger',
              type: 'button',
              title: 'Remove this account for good',
              onClick: async () => {
                const sure = window.confirm(
                  `Delete ${person.name || person.email}?\n\nThe account and its sessions go. What they did stays in the audit trail, under their name.`,
                );
                if (!sure) return;
                try {
                  await api(`/api/users/${person.id}`, { method: 'DELETE' });
                  toast('Account deleted.');
                  refresh();
                } catch (error) {
                  toast(error.message, true);
                }
              },
            },
            'Delete',
          ),
        );
      }

      // The product-owner flag: only an operator may hand it on, and it never travels
      // with the agency's ownership.
      if (state.me?.isOperator === true && !person.disabled) {
        actions.append(
          el(
            'button',
            {
              class: 'btn btn-sm btn-ghost',
              type: 'button',
              title: 'Decides who reads the feedback queue',
              onClick: async () => {
                try {
                  await api(`/api/users/${person.id}/operator`, {
                    method: 'POST',
                    body: JSON.stringify({ isOperator: person.isOperator !== true }),
                  });
                  toast(person.isOperator ? 'The flag has been taken away.' : 'They can read the feedback queue now.');
                  refresh();
                } catch (error) {
                  toast(error.message, true);
                }
              },
            },
            person.isOperator ? 'Remove product owner' : 'Make product owner',
          ),
        );
      }

      return el(
        'div',
        { class: 'bo-row' },
        el(
          'div',
          { class: 'bo-what' },
          el(
            'strong',
            {},
            person.name || person.email,
            person.id === state.me?.id ? el('span', { class: 'small' }, ' (you)') : null,
            person.isOperator === true ? el('span', { class: 'badge badge-ok' }, 'product owner') : null,
          ),
          el(
            'span',
            {},
            `${person.email}${person.landlordName === null ? '' : ` · ${person.landlordName}`}${
              person.lastLoginAt === null ? ' · never signed in' : ` · last in ${new Date(person.lastLoginAt).toLocaleString('en-GB')}`
            }`,
          ),
        ),
        el('div', { style: { display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' } },
          person.disabled ? el('span', { class: 'badge badge-warn' }, 'switched off') : roleBadge(person.role),
          actions,
        ),
      );
    };

    const people = el(
      'div',
      { class: 'bo-section' },
      el('h3', {}, `People · ${data.users.length}`),
      el('p', { class: 'small' }, 'Agents can do everything about tenancies. Landlords can only read their own.'),
      el('div', {}, ...data.users.map(personRow)),
    );

    const logRows = (log.events ?? []).slice(0, 25).map((event) =>
      el(
        'div',
        { class: 'bo-row' },
        el(
          'div',
          { class: 'bo-what' },
          el('strong', {}, eventWords(event.kind)),
          el('span', {}, `${event.actorName}${event.detail === '' ? '' : ` · ${event.detail}`}`),
        ),
        el('span', { class: 'small' }, new Date(event.at).toLocaleString('en-GB')),
      ),
    );

    box.replaceChildren(
      addPerson,
      people,
      el(
        'div',
        { class: 'bo-section' },
        el('h3', {}, 'Recent activity'),
        el('p', { class: 'small' }, 'Who did what, across the whole agency. Every pack’s own History tab has the tenancy-level version.'),
        logRows.length === 0 ? el('p', { class: 'small' }, 'Nothing yet.') : el('div', {}, ...logRows),
      ),
    );
  })();

  return box;
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
