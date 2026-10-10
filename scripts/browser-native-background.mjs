/** Genuine background acceptance. Run with Node >=22.4 under xvfb-run.
 *
 * This deliberately does NOT use Playwright: its launch switches disable
 * background timer throttling and its page session enables focus emulation.
 * Direct headed system Chrome keeps the sandbox and native background defaults.
 * The only page injection is passive, before-app observation. No Date, performance,
 * RAF, timer, visibility, lifecycle, or Storage API is replaced or emulated.
 * Qualification performs only passive CDP reads. Export is an explicitly labelled
 * programmatic existing-UI action AFTER qualification, to observe adopted state.
 */
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://127.0.0.1:4173/Infinity/' },
  fixture: { type: 'string', default: 'native-background-review-save.json' },
  output: { type: 'string', default: 'native-background-evidence' },
  chromium: { type: 'string' },
} });
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const startedAt = Date.now(), startedMono = performance.now();
// Leave five seconds for owned-process cleanup and evidence inside a 180s budget.
const workDeadline = startedMono + 175_000;
const report = {
  completed: false, classification: 'real HTTP / headed system Chrome / native hidden tabs, clocks, timers, RAF and localStorage',
  scope: 'Two >=32s real hidden intervals with >=2 native 15s autosaves each. Not multi-hour, OS sleep, wall-clock-jump or mobile suspension proof.',
  boundsMs: { launch: 15_000, cdp: 5_000, hiddenCase: 50_000, reloadOrResume: 10_000, whole: 180_000 },
  startedAt, url: values.url, checks: [], cases: [], lifecycle: [], storageEvents: [], errors: [], requests: [], actions: [], screenshots: [],
  forbiddenTechniques: ['headless', 'Playwright attachment', 'focus emulation', 'background-disabling flags', 'clock or API overrides', 'hidden screenshots', 'synthetic visibility events'],
};
let currentCase = 'setup', chrome, profile, cdp, gameSession, coverSession, gameTarget, coverTarget;
let stderr = '', abortError, chromeExited = false, exitPromise, phaseDeadline;
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
function guard() {
  if (abortError) throw abortError;
  if (performance.now() >= workDeadline) throw new Error('Native background acceptance exceeded its 175s work budget');
  if (phaseDeadline && performance.now() >= phaseDeadline.until) throw new Error(`${currentCase}: ${phaseDeadline.name} exceeded its ${phaseDeadline.budget}ms budget`);
}
async function withinBudget(name, budget, task) {
  const previous = phaseDeadline;
  phaseDeadline = { name, budget, until: Math.min(workDeadline, previous?.until ?? Infinity, performance.now() + budget) };
  try {
    const result = await task();
    guard();
    return result;
  } finally { phaseDeadline = previous; }
}
function check(name, passed, detail) {
  report.checks.push({ case: currentCase, name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
  if (!passed) throw new Error(`${currentCase}: ${name}`);
}
async function poll(name, read, timeout = 10_000, interval = 100) {
  const until = Math.min(performance.now() + timeout, workDeadline, phaseDeadline?.until ?? Infinity);
  let last;
  do {
    guard();
    last = await read();
    guard();
    if (last) return last;
    await delay(interval);
  } while (performance.now() < until);
  throw new Error(`${currentCase}: timed out waiting for ${name}`);
}
async function findChrome() {
  const names = values.chromium ? [values.chromium] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const name of names) {
    const paths = name.includes('/') ? [resolve(name)] : (process.env.PATH || '').split(delimiter).map(dir => join(dir, name));
    for (const path of paths) {
      try { await access(path, constants.X_OK); return path; } catch { /* Next installed executable. */ }
    }
  }
  throw new Error('No system Chrome executable found; run the bounded browser prerequisites first');
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`));
        else pending.resolve(message.result || {});
      } else this.onEvent?.(message);
    });
    socket.addEventListener('close', () => this.rejectPending(new Error('Owned Chrome CDP connection closed')));
    socket.addEventListener('error', () => this.rejectPending(new Error('Owned Chrome CDP connection failed')));
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('CDP WebSocket connect timed out')); }, 5_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket connect failed')); }, { once: true });
    });
    return new CDP(socket);
  }
  send(method, params = {}, sessionId) {
    guard();
    const id = ++this.nextId;
    return new Promise((resolveCommand, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error(`CDP ${method} timed out`));
      }, Math.max(1, Math.min(5_000, workDeadline - performance.now(), (phaseDeadline?.until ?? Infinity) - performance.now())));
      this.pending.set(id, { resolve: resolveCommand, reject, timer, method });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  rejectPending(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  close() { this.rejectPending(new Error('CDP cleanup')); this.socket.close(); }
}

const binding = '__nativeBackgroundRecord';
function passiveDiagnostics(key) {
  return `(() => {
    const key = ${JSON.stringify(key)};
    const nativeDate = Date.now, nativePerformance = performance.now.bind(performance);
    const nativeRAF = requestAnimationFrame.bind(window), nativeGet = Storage.prototype.getItem;
    const native = fn => /\\[native code\\]/.test(Function.prototype.toString.call(fn));
    const raw = () => { try { return nativeGet.call(localStorage, key); } catch { return null; } };
    const startedWall = nativeDate(), startedPerf = nativePerformance();
    const probe = { id: startedWall + ':' + startedPerf, startedWall, startedPerf,
      initialVisibility: document.visibilityState, initialHidden: document.hidden, initialRaw: raw(),
      native: { date: native(Date.now), performance: native(performance.now), raf: native(requestAnimationFrame),
        interval: native(setInterval), timeout: native(setTimeout),
        storageGet: native(Storage.prototype.getItem), storageSet: native(Storage.prototype.setItem),
        visibility: native(Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState').get),
        hidden: native(Object.getOwnPropertyDescriptor(Document.prototype, 'hidden').get),
        storageInstance: localStorage instanceof Storage },
      rafCount: 0, lastRaf: null, events: [] };
    function record(type, event) {
      const row = { id: probe.id, type, trusted: event ? event.isTrusted : null,
        wall: nativeDate(), perf: nativePerformance(), visibility: document.visibilityState, hidden: document.hidden,
        rafCount: probe.rafCount, lastRaf: probe.lastRaf,
        ...(type === 'beforeunload' || type === 'pagehide' ? { raw: raw() } : {}) };
      probe.events.push(row);
      window.${binding}(JSON.stringify(row));
    }
    document.addEventListener('visibilitychange', event => record('visibilitychange', event));
    window.addEventListener('beforeunload', event => record('beforeunload', event));
    window.addEventListener('pagehide', event => record('pagehide', event));
    function heartbeat(timestamp) { probe.rafCount++; probe.lastRaf = timestamp; nativeRAF(heartbeat); }
    nativeRAF(heartbeat);
    record('document-start');
    window.__nativeBackgroundProbe = { snapshot: () => ({ ...probe, events: [...probe.events],
      wallNow: nativeDate(), perfNow: nativePerformance(), visibility: document.visibilityState, hidden: document.hidden, storedRaw: raw(),
      href: location.href, ready: !!document.querySelector('[data-action="export"]') && !!document.querySelector('[data-bind="amount-metal"]') }) };
  })();`;
}
async function evaluate(expression, sessionId = gameSession) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false }, sessionId);
  if (result.exceptionDetails) throw new Error(`Page observation failed: ${JSON.stringify(result.exceptionDetails)}`);
  return result.result.value;
}
const probe = () => evaluate('window.__nativeBackgroundProbe?.snapshot() ?? null');
async function navigatedProbe(predicate) {
  try { const value = await probe(); return value && predicate(value) ? value : null; }
  catch (error) {
    if (/Cannot find context|Execution context was destroyed|Inspected target navigated/.test(String(error))) return null;
    throw error;
  }
}
function checkNative(value) {
  check('all observed browser clock, timer, RAF, visibility and Storage APIs are native', Object.values(value.native).every(Boolean), value.native);
}
function save(raw) {
  const value = JSON.parse(raw);
  if (!Number.isFinite(value.savedAt) || !Number.isFinite(value.lastTickAt) || !Number.isFinite(Number(value.state?.totalTime))) {
    throw new Error('Native storage event did not contain a finite save snapshot');
  }
  return value;
}
const stateBytes = value => JSON.stringify(value.state);
const total = value => Number(value.state.totalTime);
function assertCredit(name, before, after) {
  const expected = (after.lastTickAt - before.lastTickAt) / 1000;
  const actual = total(after) - total(before);
  check(name, expected >= 0 && Math.abs(actual - expected) < 0.01, { expectedSeconds: expected, actualSeconds: actual, toleranceSeconds: 0.01 });
  return actual;
}
async function screenshot(name) {
  const now = await probe();
  check('screenshot is taken only while genuinely visible', now && !now.hidden && now.visibility === 'visible');
  const capture = await cdp.send('Page.captureScreenshot', { format: 'png' }, gameSession);
  await writeFile(join(output, name), Buffer.from(capture.data, 'base64'));
  report.screenshots.push({ case: currentCase, file: name, wall: now.wallNow, visibility: now.visibility });
}
async function exportObserved(label) {
  report.actions.push({ case: currentCase, label, hostWall: Date.now(), kind: 'explicit programmatic existing export action, after hidden qualification' });
  const observed = await evaluate(`(() => {
    const before = window.__nativeBackgroundProbe.snapshot();
    document.querySelector('[data-action="export"]').click();
    return { before, after: window.__nativeBackgroundProbe.snapshot(), raw: document.querySelector('#transfer').value };
  })()`);
  observed.save = save(observed.raw);
  return observed;
}

async function prepareCase(label, fixture, origin, appUrl) {
  currentCase = label;
  await cdp.send('Target.activateTarget', { targetId: gameTarget });
  await cdp.send('Page.navigate', { url: new URL('release.json', appUrl).href }, gameSession);
  await poll('same-origin fixture setup document', () => navigatedProbe(p => p.href === new URL('release.json', appUrl).href));
  const storageId = { securityOrigin: origin, isLocalStorage: true };
  await cdp.send('DOMStorage.clear', { storageId }, gameSession);
  const epoch = await evaluate('Date.now()');
  const seed = { ...fixture.save, savedAt: epoch, lastTickAt: epoch };
  report.actions.push({ case: label, kind: 'native CDP storage fixture setup before app navigation', epoch });
  await cdp.send('DOMStorage.setDOMStorageItem', { storageId, key: fixture.key, value: JSON.stringify(seed) }, gameSession);
  await cdp.send('DOMStorage.setDOMStorageItem', { storageId, key: 'infinity.ui.tab', value: 'save' }, gameSession);
  await cdp.send('Page.navigate', { url: appUrl }, gameSession);
  const ready = await poll('visible production game', () => navigatedProbe(p => p.href === appUrl && p.ready && !p.hidden && p.visibility === 'visible'));
  checkNative(ready);
  const moving = await poll('native visible RAF heartbeat advances', () => navigatedProbe(p => p.id === ready.id && p.rafCount >= ready.rafCount + 3));
  check('game loaded from seeded native localStorage', save(moving.initialRaw).savedAt === epoch);
  const caseReport = { name: label, visibleStart: moving, samples: [], autosaves: [] };
  report.cases.push(caseReport);
  await screenshot(`${label}-before-hidden.png`);
  return caseReport;
}

async function qualifyHidden(caseReport) {
  return withinBudget('native hidden qualification', 50_000, () => qualifyHiddenWithinBudget(caseReport));
}
async function qualifyHiddenWithinBudget(caseReport) {
  const eventStart = report.storageEvents.length;
  const started = performance.now();
  await cdp.send('Target.activateTarget', { targetId: coverTarget });
  const hidden = await poll('trusted native hidden visibility', () => navigatedProbe(p => p.hidden && p.visibility === 'hidden' &&
    p.events.some(e => e.type === 'visibilitychange' && e.trusted && e.hidden && e.visibility === 'hidden')), 1_000, 50);
  const hiddenEvent = hidden.events.findLast(e => e.type === 'visibilitychange' && e.hidden);
  check('cover is genuinely visible in the same browser window', await evaluate('!document.hidden && document.visibilityState === "visible"', coverSession));
  // Allow at most one second after the real hidden event for transition RAF work.
  await delay(Math.max(0, 1_000 - (hidden.perfNow - hiddenEvent.perf)));
  const plateau = await probe();
  check('hidden transition settles within one second, without visibility emulation', plateau.hidden && plateau.visibility === 'hidden' && plateau.perfNow - hiddenEvent.perf < 1_500);
  caseReport.hiddenEvent = hiddenEvent;
  caseReport.plateau = plateau;
  const transitionSave = save(plateau.storedRaw);
  const transitionRow = report.storageEvents.slice(eventStart).findLast(row => row.raw === plateau.storedRaw &&
    row.snapshot?.savedAt >= hiddenEvent.wall - 2 && row.snapshot.savedAt <= plateau.wallNow + 2);
  check('native hidden transition save is captured before timer qualification', !!transitionRow);
  caseReport.transitionSave = transitionRow;
  let end;
  while (performance.now() - started < 50_000) {
    guard();
    const sample = await probe();
    caseReport.samples.push({ wall: sample.wallNow, perf: sample.perfNow, hidden: sample.hidden, visibility: sample.visibility, rafCount: sample.rafCount, lastRaf: sample.lastRaf });
    if (sample.id !== plateau.id || !sample.hidden || sample.visibility !== 'hidden' || sample.rafCount !== plateau.rafCount ||
        sample.events.some(e => e.perf > hiddenEvent.perf && e.type === 'visibilitychange' && !e.hidden)) {
      throw new Error(`${currentCase}: native hidden state or uninterrupted RAF plateau was not established`);
    }
    const rows = report.storageEvents.slice(eventStart).filter(row => row.snapshot && row.snapshot.savedAt > plateau.wallNow);
    caseReport.autosaves = rows;
    if (sample.perfNow - plateau.perfNow >= 32_000 && sample.wallNow - plateau.wallNow >= 32_000 && rows.length >= 2) {
      end = sample; break;
    }
    await delay(250); // Host timer, never await an animation frame in the hidden document.
  }
  check('at least 32 native seconds hidden and at least two subsequent native autosaves', !!end,
    { hiddenSamples: caseReport.samples.length, autosaves: caseReport.autosaves.length });
  const rows = caseReport.autosaves, first = rows[0].snapshot;
  check('passive native Date and performance agree through hidden interval',
    Math.abs((end.wallNow - hiddenEvent.wall) - (end.perfNow - hiddenEvent.perf)) < 500);
  check('native RAF heartbeat is continuously suspended after transition', end.rafCount === plateau.rafCount && end.lastRaf === plateau.lastRaf);
  const transitionFrames = plateau.rafCount - hiddenEvent.rafCount;
  const transitionFrameMs = plateau.lastRaf - hiddenEvent.lastRaf;
  const transitionCreditMs = first.lastTickAt - transitionSave.lastTickAt;
  caseReport.transitionFrames = { count: transitionFrames, elapsedMs: transitionFrameMs, accountedAdvanceMs: transitionCreditMs,
    classification: transitionFrames === 0 ? 'no final native RAF; exact transition snapshot retained' : 'final native RAF during settling; first later native timer save observes settled state' };
  if (transitionFrames === 0) {
    check('without transition RAF work, the first timer save retains the complete visibility-event snapshot',
      first.lastTickAt === transitionSave.lastTickAt && stateBytes(first) === stateBytes(transitionSave));
  } else {
    // A final native RAF may run during the permitted transition. The first
    // later native autosave observes that settled live state without forcing a
    // save or export. Do not assume heartbeat and application callback ordering:
    // credit must fit the transition, then later saves preserve complete state.
    check('any permitted transition credit is explained by the observed native RAF work',
      transitionFrames > 0 && transitionFrameMs > 0 && transitionFrameMs < 1_500 &&
      transitionCreditMs >= 0 && transitionCreditMs <= 1_000 && first.lastTickAt <= plateau.wallNow + 2,
      { transitionFrames, transitionFrameMs, accountedAdvanceMs: transitionCreditMs, plateauWall: plateau.wallNow });
    assertCredit('permitted transition RAF work receives only its accounted totalTime credit', transitionSave, first);
  }
  check('hidden autosaves retain the same complete settled simulation state and accounted watermark',
    rows.every(row => row.snapshot.lastTickAt === first.lastTickAt && stateBytes(row.snapshot) === stateBytes(first)));
  check('settled accounted watermark does not advance beyond the hidden transition', first.lastTickAt <= hiddenEvent.wall + 1_000);
  check('native 15s autosave savedAt advances with scheduler tolerance', rows.slice(1).every((row, index) => {
    const delta = row.snapshot.savedAt - rows[index].snapshot.savedAt;
    return delta >= 14_000 && delta <= 20_000;
  }), rows.map(row => ({ savedAt: row.snapshot.savedAt, lastTickAt: row.snapshot.lastTickAt, hostWall: row.hostWall })));
  check('autosave timestamps are actual native wall time', rows.every(row => Math.abs(row.hostWall - row.snapshot.savedAt) < 2_000));
  caseReport.hiddenEnd = end;
  caseReport.hiddenDurationMs = end.perfNow - hiddenEvent.perf;
  caseReport.suspendedPlateauDurationMs = end.perfNow - plateau.perfNow;
  caseReport.baseline = rows.at(-1).snapshot;
  return caseReport.baseline;
}

async function reloadObserved(expectHidden) {
  return withinBudget('native reload and source observation', 10_000, () => reloadWithinBudget(expectHidden));
}
async function reloadWithinBudget(expectHidden) {
  const before = await probe(), start = report.storageEvents.length;
  report.actions.push({ case: currentCase, kind: 'native Page.reload', expectHidden, hostWall: Date.now(), before });
  await cdp.send('Page.reload', { ignoreCache: true }, gameSession);
  const loaded = await poll('new production document after native reload', () => navigatedProbe(p => p.id !== before.id && p.ready));
  checkNative(loaded);
  check('reload preserves expected native tab visibility', loaded.hidden === expectHidden && loaded.initialHidden === expectHidden &&
    loaded.visibility === (expectHidden ? 'hidden' : 'visible') && loaded.initialVisibility === loaded.visibility);
  // A dying document's pagehide binding was absent in the first real CI run.
  // Do not infer that the DOM event fired or that Runtime delivered it. Require
  // the directly observed beforeunload -> native storage write -> new document
  // chain instead; pagehide, when delivered, is additional exact-byte evidence.
  const lifecycle = await poll('trusted beforeunload, actual native unload write and new-document evidence', async () => {
    const rows = report.lifecycle.filter(row => row.id === before.id);
    const unload = rows.findLast(row => row.type === 'beforeunload');
    const pagehide = rows.findLast(row => row.type === 'pagehide');
    const documentStart = report.lifecycle.find(row => row.id === loaded.id && row.type === 'document-start');
    const storageWrite = report.storageEvents.slice(start).find(row => row.snapshot && row.raw === loaded.initialRaw);
    return unload?.trusted && documentStart && storageWrite ? { unload, pagehide: pagehide ?? null, documentStart, storageWrite,
      evidence: 'trusted native beforeunload, native savedAt bracket, actual DOMStorage write and exact new-document initial source bytes',
      pagehideDelivery: pagehide ? 'observed; independently validated' : 'not observed; no delivery or occurrence claim' } : null;
  });
  const source = save(loaded.initialRaw);
  check('new document consumed the exact actual native unload-write source bytes', lifecycle.storageWrite.raw === loaded.initialRaw);
  check('trusted beforeunload occurs after the native pre-reload observation',
    lifecycle.unload.wall >= before.wallNow - 2 && lifecycle.unload.perf >= before.perfNow,
    { beforeWall: before.wallNow, beforePerf: before.perfNow,
      unloadWall: lifecycle.unload.wall, unloadPerf: lifecycle.unload.perf });
  // Runtime and DOMStorage notifications may reach the host in a different
  // order. Record delivery timing, but prove write-before-read with the native
  // savedAt bracket below and the exact bytes already read by the new document.
  lifecycle.notificationDelivery = {
    unloadHostMono: lifecycle.unload.hostMono,
    writeHostMono: lifecycle.storageWrite.hostMono,
    newDocumentHostMono: lifecycle.documentStart.hostMono,
    writeNotificationAfterDocumentMs: lifecycle.storageWrite.hostMono - lifecycle.documentStart.hostMono,
    classification: 'cross-domain notification delivery only; not the order of native storage operations',
  };
  check('actual unload savedAt is after beforeunload and inside the native new-document bracket',
    source.savedAt >= lifecycle.unload.wall - 2 && source.savedAt <= loaded.startedWall + 2,
    { before: before.wallNow, beforeunload: lifecycle.unload.wall, sourceSavedAt: source.savedAt,
      newDocumentStarted: loaded.startedWall, loaded: loaded.wallNow });
  if (lifecycle.pagehide) {
    check('observed pagehide is trusted and independently confirms the exact new-document source bytes',
      lifecycle.pagehide.trusted && lifecycle.pagehide.raw === loaded.initialRaw &&
      lifecycle.pagehide.perf >= lifecycle.unload.perf && lifecycle.pagehide.wall <= loaded.startedWall + 2);
  }
  return { before, loaded, source, lifecycle, actualInitialRaw: loaded.initialRaw };
}

async function resumeVisible() {
  return withinBudget('native foreground resume', 10_000, async () => {
    const before = await probe();
    await cdp.send('Target.activateTarget', { targetId: gameTarget });
    return poll('trusted visible event and resumed native RAF heartbeat', () => navigatedProbe(p => p.id === before.id && !p.hidden && p.visibility === 'visible' &&
      p.rafCount > before.rafCount && p.events.some(e => e.type === 'visibilitychange' && e.trusted && !e.hidden && e.perf >= before.perfNow)));
  });
}

async function run() {
  check('Node built-in WebSocket is available', typeof WebSocket === 'function');
  check('headed display supplied by xvfb-run', !!process.env.DISPLAY);
  const app = new URL(values.url);
  check('acceptance uses local real HTTP', app.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(app.hostname));
  const fixture = JSON.parse(await readFile(values.fixture, 'utf8'));
  report.fixtureDescription = fixture.description;
  const executable = await findChrome();
  profile = await mkdtemp(join(tmpdir(), 'infinity-native-background-'));
  const chromeArgs = [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--window-size=1440,1100', 'about:blank'];
  report.chrome = { executable, arguments: chromeArgs, sandbox: 'unchanged native default', backgroundBehavior: 'unchanged native default' };
  chrome = spawn(executable, chromeArgs, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', chunk => { stderr += chunk.toString(); });
  chrome.on('error', error => { report.errors.push({ kind: 'chrome-spawn', error: String(error) }); });
  exitPromise = new Promise(resolveExit => chrome.once('exit', (code, signal) => {
    chromeExited = true; report.chrome.exit = { code, signal }; resolveExit();
  }));
  const endpoint = await poll('owned Chrome DevToolsActivePort', async () => {
    if (chromeExited) throw new Error(`Owned Chrome exited during launch: ${stderr}`);
    try {
      const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
      if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !path?.startsWith('/devtools/browser/')) return null;
      return `ws://127.0.0.1:${port}${path}`;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }, 15_000);
  cdp = await CDP.connect(endpoint);
  cdp.onEvent = message => {
    const { method, params, sessionId } = message;
    const hostWall = Date.now(), hostMono = performance.now() - startedMono;
    if (sessionId !== gameSession) return;
    if (method === 'Runtime.bindingCalled' && params.name === binding) {
      report.lifecycle.push({ ...JSON.parse(params.payload), case: currentCase, hostWall, hostMono });
    } else if (['DOMStorage.domStorageItemAdded', 'DOMStorage.domStorageItemUpdated'].includes(method) && params.key === fixture.key && params.storageId.isLocalStorage) {
      const raw = params.newValue;
      let snapshot;
      try { snapshot = save(raw); } catch (error) { report.errors.push({ case: currentCase, kind: 'invalid-native-save', error: String(error) }); }
      report.storageEvents.push({ case: currentCase, method, storageId: params.storageId, hostWall, hostMono, raw, snapshot });
    } else if (method === 'Runtime.exceptionThrown') report.errors.push({ case: currentCase, kind: 'page-exception', details: params.exceptionDetails });
    else if (method === 'Network.loadingFailed' && !params.canceled) report.errors.push({ case: currentCase, kind: 'network-failure', details: params });
    else if (method === 'Network.responseReceived' && params.type === 'Document') report.requests.push({ case: currentCase, url: params.response.url, status: params.response.status });
  };
  report.chrome.version = await cdp.send('Browser.getVersion');
  check('system browser is headed Chrome', !/Headless/i.test(report.chrome.version.product));
  const targets = await cdp.send('Target.getTargets');
  gameTarget = targets.targetInfos.find(target => target.type === 'page' && target.url === 'about:blank')?.targetId;
  check('owned initial ordinary game tab exists', !!gameTarget);
  ({ targetId: coverTarget } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: false, background: true }));
  const gameWindow = await cdp.send('Browser.getWindowForTarget', { targetId: gameTarget });
  const coverWindow = await cdp.send('Browser.getWindowForTarget', { targetId: coverTarget });
  report.windows = { game: gameWindow, cover: coverWindow };
  check('two ordinary tabs are in the exact same Chrome window', gameTarget !== coverTarget && gameWindow.windowId === coverWindow.windowId);
  ({ sessionId: gameSession } = await cdp.send('Target.attachToTarget', { targetId: gameTarget, flatten: true }));
  ({ sessionId: coverSession } = await cdp.send('Target.attachToTarget', { targetId: coverTarget, flatten: true }));
  await cdp.send('Runtime.enable', {}, coverSession);
  for (const method of ['Page.enable', 'Runtime.enable', 'DOMStorage.enable', 'Network.enable']) await cdp.send(method, {}, gameSession);
  await cdp.send('Runtime.addBinding', { name: binding }, gameSession);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: passiveDiagnostics(fixture.key) }, gameSession);
  await mkdir(join(profile, 'downloads'));
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(profile, 'downloads') });

  const hiddenReload = await prepareCase('hidden-reload', fixture, app.origin, app.href);
  const hiddenBase = await qualifyHidden(hiddenReload);
  hiddenReload.reload = await reloadObserved(true);
  check('hidden beforeunload advances savedAt without advancing state or accounted watermark',
    hiddenReload.reload.source.savedAt > hiddenBase.savedAt && hiddenReload.reload.source.lastTickAt === hiddenBase.lastTickAt &&
    stateBytes(hiddenReload.reload.source) === stateBytes(hiddenBase));
  hiddenReload.observed = await exportObserved('observe adopted state while reload remains genuinely hidden');
  check('hidden reloaded document never becomes visible and native RAF remains suspended', hiddenReload.observed.after.hidden &&
    hiddenReload.observed.after.rafCount === 0 && !hiddenReload.observed.after.events.some(e => e.type === 'visibilitychange' && !e.hidden));
  check('loaded accounted watermark lies inside the native new-document bracket',
    hiddenReload.observed.save.lastTickAt >= hiddenReload.reload.loaded.startedWall - 2 && hiddenReload.observed.save.lastTickAt <= hiddenReload.observed.before.wallNow + 2);
  const hiddenCredit = assertCredit('hidden reload credits the whole interval from the old accounted watermark', hiddenReload.reload.source, hiddenReload.observed.save);
  check('credit includes time before the last hidden autosave, not just time since savedAt', hiddenCredit >= 32 &&
    hiddenCredit - (hiddenReload.observed.save.lastTickAt - hiddenBase.savedAt) / 1000 >= 20);
  hiddenReload.resumed = await resumeVisible();
  await screenshot('hidden-reload-after-visible.png');

  const resumedReload = await prepareCase('resume-then-reload', fixture, app.origin, app.href);
  const resumedBase = await qualifyHidden(resumedReload);
  const resumedEventStart = report.storageEvents.length;
  resumedReload.resumed = await resumeVisible();
  const catchupRow = await poll('native catch-up save after real foreground RAF resumes', async () =>
    report.storageEvents.slice(resumedEventStart).find(row => row.snapshot && row.snapshot.lastTickAt - resumedBase.lastTickAt >= 32_000));
  resumedReload.catchupSave = catchupRow;
  const resumeCredit = assertCredit('real foreground catch-up credits the full hidden accounted gap exactly once', resumedBase, catchupRow.snapshot);
  check('foreground catch-up really includes the hidden interval', resumeCredit >= 32);
  check('native reload begins shortly after the real catch-up save', Date.now() - catchupRow.snapshot.savedAt < 2_000);
  resumedReload.reload = await reloadObserved(false);
  assertCredit('actual beforeunload source includes only additional foreground progress', catchupRow.snapshot, resumedReload.reload.source);
  resumedReload.observed = await exportObserved('observe state after foreground catch-up and subsequent native reload');
  const shortCredit = assertCredit('subsequent reload adds only the new short accounted interval', resumedReload.reload.source, resumedReload.observed.save);
  check('the old hidden interval cannot be credited again by reload', shortCredit < 10 && shortCredit < resumeCredit / 2);
  assertCredit('combined hidden catch-up and reload has no duplicate totalTime credit', resumedBase, resumedReload.observed.save);
  await screenshot('resume-then-reload-after-visible.png');
  check('all observed production documents returned HTTP 200', report.requests.length >= 6 && report.requests.every(request => request.status === 200));
  check('no browser exceptions, failed requests or invalid save snapshots', report.errors.length === 0, report.errors);
  report.completed = true;
}

let deadlineTimer;
try {
  await Promise.race([
    run(),
    new Promise((_, reject) => { deadlineTimer = setTimeout(() => {
      abortError = new Error('Native background acceptance reached its 175s work deadline; preserving evidence and cleaning up');
      cdp?.rejectPending(abortError); reject(abortError);
    }, 175_000); }),
  ]);
} catch (error) {
  report.failure = { case: currentCase, message: String(error), stack: error.stack };
  process.exitCode = 1;
} finally {
  clearTimeout(deadlineTimer);
  // Never focus or screenshot a hidden page to gather failure evidence.
  if (cdp && gameSession && !abortError) {
    try { report.finalPassiveProbe = await probe(); } catch (error) { report.finalProbeError = String(error); }
  }
  abortError ||= new Error('Acceptance finished; no further test actions permitted');
  cdp?.close();
  if (chrome?.pid) {
    // The detached process group belongs only to this launch. Descendants can
    // outlive its leader, so the leader's exit alone does not complete cleanup.
    const signalGroup = signal => {
      try { process.kill(-chrome.pid, signal); return true; }
      catch (error) { if (error.code !== 'ESRCH') report.cleanupError = String(error); return false; }
    };
    if (signalGroup('SIGTERM')) {
      const graceUntil = performance.now() + 1_500;
      while (performance.now() < graceUntil && signalGroup(0)) await delay(50);
      if (signalGroup(0)) {
        signalGroup('SIGKILL');
        await Promise.race([exitPromise, delay(1_000)]);
      }
    }
  }
  if (profile) {
    try { await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); }
    catch (error) { report.cleanupError = String(error); }
  }
  if (report.cleanupError) { report.completed = false; process.exitCode = 1; }
  report.finishedAt = Date.now();
  report.durationMs = performance.now() - startedMono;
  report.passed = report.checks.filter(row => row.passed).length;
  await writeFile(join(output, 'chrome-stderr.log'), stderr);
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ completed: report.completed, passed: report.passed, durationMs: report.durationMs, evidence: output, failure: report.failure }, null, 2));
}
