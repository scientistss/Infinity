/** Test-only final manual-unit case. Headed owned Chrome, raw CDP, no Playwright.
 * The supplied existing CLOCK is the sole functional-clock injection. Native
 * visibility, storage, input, timers and pre-injection wall/monotonic observations
 * are retained. Hidden observations are passive; only visible zero-time advances.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, link, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual, parseArgs } from 'node:util';

if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('CI-only native hidden acceptance');

const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' } } });
if (!values.input || !values.output) throw new Error('Required: --input JSON --output NEW_DIRECTORY');
const started = performance.now(), startedAt = Date.now();
const workDeadline = started + 39_000, wholeDeadline = started + 45_000;
const output = resolve(values.output);
await mkdir(output); // Exclusivity is mandatory, even for an empty old directory.
await mkdir(join(output, 'raw'));
const report = { schema: 'infinity-manual-unit-hidden-report-v1', completed: false, result: 'failed', failure: null,
  case: 'SYNTHETIC-consumed-native-hidden-resume', startedAt,
  boundsMs: { whole: 45_000, work: 39_000, hidden: 5_000, resume: 5_000, cdp: 5_000 },
  classification: 'Synthetic exact fixture; real HTTP/V8; owned headed Chrome; native trusted input and visibility. Existing controlled functional clocks, zero elapsed game time. No background-throttling or real-play-duration claim.',
  checks: [], evidence: [], sourceBindings: [], releaseMetadata: null, functionalAdvanceCalls: [], lifecycle: [],
  actions: [], storageSnapshots: [], errors: [], requests: [], scrollSamples: [],
  cleanup: { socketClosed: false, processExited: false, processGroupGone: false, profileRemoved: false },
};
let input, evidenceRoot, sequence = 0, chrome, profile, cdp, gameSession, gameTarget, coverSession, coverTarget;
let stderr = '', chromeExited = false, exitPromise, stopping = false, phaseUntil = workDeadline;
let appNavigated = false, hiddenPhase = false, deadlineTimer, failureCaptureUntil = 0, runPromise;
const workAbort = new AbortController();
const requests = new Map(), responses = [], scripts = [], loads = new Set();
const delay = ms => new Promise(r => setTimeout(r, ms));
const digest = body => createHash('sha256').update(body).digest('hex');
const remaining = (diagnostic = false) => Math.max(1, Math.min(5_000, (diagnostic ? failureCaptureUntil : Math.min(workDeadline, phaseUntil)) - performance.now()));
function guard(diagnostic = false) {
  if (diagnostic) { if (performance.now() >= failureCaptureUntil) throw new Error('Failure capture deadline'); return; }
  if (stopping || performance.now() >= workDeadline || performance.now() >= phaseUntil) throw new Error('Bounded native hidden work deadline');
}
async function bytes(label, body, suffix = 'bin') {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const path = join(output, 'raw', `${String(++sequence).padStart(6, '0')}-${label}.${suffix}`);
  await writeFile(path, data, { flag: 'wx' });
  const file = relative(evidenceRoot || dirname(output), path).split(sep).join('/');
  if (file.startsWith('../') || isAbsolute(file)) throw new Error('Evidence outside evidenceRoot');
  const ref = { file, sha256: digest(data), bytes: data.length };
  report.evidence.push(ref); return ref;
}
const json = (label, value) => bytes(label, JSON.stringify(value, null, 2) + '\n', 'json');
function check(name, passed, detail = null) {
  report.checks.push({ name, passed: !!passed, detail });
  if (!passed) throw new Error(name);
}
async function poll(name, read, timeout = 5_000, interval = 40) {
  const until = Math.min(performance.now() + timeout, workDeadline, phaseUntil);
  do { guard(); const value = await read(); guard(); if (value) return value; await delay(interval); }
  while (performance.now() < until);
  throw new Error(`Timed out: ${name}`);
}
async function phase(name, milliseconds, work) {
  const before = phaseUntil; phaseUntil = Math.min(before, performance.now() + milliseconds);
  try { const value = await work(); guard(); return value; }
  catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); }
  finally { phaseUntil = before; }
}
class CDP {
  constructor(socket) {
    this.socket = socket; this.nextId = 0; this.pending = new Map(); this.closed = false;
    this.closedPromise = new Promise(done => { this.resolveClosed = done; });
    socket.addEventListener('message', event => {
      let message; try { message = JSON.parse(event.data); } catch (error) { report.errors.push({ kind: 'cdp-json', error: String(error) }); return; }
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`));
        else pending.resolve(message.result || {});
      } else this.onEvent?.(message);
    });
    socket.addEventListener('close', () => { this.closed = true; this.rejectPending(new Error('Owned CDP closed')); this.resolveClosed(); });
    socket.addEventListener('error', () => this.rejectPending(new Error('Owned CDP error')));
  }
  static async connect(url) {
    const socket = new WebSocket(url), instance = new CDP(socket);
    await new Promise((ok, fail) => {
      const timer = setTimeout(() => { socket.close(); fail(new Error('CDP connect timeout')); }, remaining());
      socket.addEventListener('open', () => { clearTimeout(timer); ok(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); socket.close(); fail(new Error('CDP connect error')); }, { once: true });
    });
    return instance;
  }
  send(method, params = {}, sessionId, diagnostic = false) {
    guard(diagnostic); const id = ++this.nextId;
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => { this.pending.delete(id); fail(new Error(`CDP timeout: ${method}`)); }, remaining(diagnostic));
      this.pending.set(id, { resolve: ok, reject: fail, timer, method });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); fail(error); }
    });
  }
  rejectPending(error) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); }
  async close() {
    this.rejectPending(new Error('CDP cleanup')); this.socket.close();
    await Promise.race([this.closedPromise, delay(700)]); return this.closed;
  }
}
const binding = '__manualNativeHiddenRecord';
function diagnostics(key) {
  return `(() => {
    const date = Date.now.bind(Date), perf = performance.now.bind(performance);
    const get = Storage.prototype.getItem, native = fn => /\\[native code\\]/.test(Function.prototype.toString.call(fn));
    const id = date() + ':' + perf() + ':native-document', events = [], clicks = []; let sequence = 0;
    const key = ${JSON.stringify(key)};
    const APIs = () => ({ storageGet:native(Storage.prototype.getItem), storageSet:native(Storage.prototype.setItem), fileText:native(File.prototype.text),
      confirm:native(window.confirm), timeout:native(setTimeout), interval:native(setInterval),
      hidden:native(Object.getOwnPropertyDescriptor(Document.prototype,'hidden').get),
      visibility:native(Object.getOwnPropertyDescriptor(Document.prototype,'visibilityState').get),
      noOwnHidden:!Object.hasOwn(document,'hidden'), noOwnVisibility:!Object.hasOwn(document,'visibilityState'), storageInstance:localStorage instanceof Storage });
    const record = (type,event,extra={}) => { const row={id,seq:++sequence,type,trusted:event?event.isTrusted:null,
      nativeWall:date(),nativeMono:perf(),hidden:document.hidden,state:document.visibilityState,...extra}; events.push(row); window.${binding}(JSON.stringify(row)); return row; };
    document.addEventListener('visibilitychange',event=>record('visibilitychange',event),true);
    window.addEventListener('pagehide',event=>record('pagehide',event),true);
    window.addEventListener('beforeunload',event=>record('beforeunload',event),true);
    document.addEventListener('click',event=>{const button=event.target.closest?.('button');if(button)clicks.push(record('click',event,{action:button.dataset.action||button.dataset.tab||null,unit:button.dataset.id||null}));},true);
    const initialRaw=get.call(localStorage,key), initialAPIs=APIs(); record('document-start',null);
    window.__manualNativeHiddenProbe={snapshot:()=>({id,seq:sequence,events:[...events],clicks:[...clicks],initialRaw,initialAPIs,native:APIs(),
      hidden:document.hidden,state:document.visibilityState,nativeWall:date(),nativeMono:perf(),href:location.href,
      storedRaw:get.call(localStorage,key),ready:!!document.querySelector('[data-bind="ucard-small_cargo"]')&&!!window.__npcAdvance})};
  })();`;
}
async function evaluate(expression, sessionId = gameSession, awaitPromise = false, diagnostic = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, sessionId, diagnostic);
  if (result.exceptionDetails) throw new Error(`Page evaluate: ${JSON.stringify(result.exceptionDetails)}`);
  return result.result.value;
}
const probe = () => evaluate('window.__manualNativeHiddenProbe?.snapshot() ?? null');
async function storage(label) {
  const value = await evaluate(`({local:Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])),session:Object.fromEntries(Object.keys(sessionStorage).sort().map(k=>[k,sessionStorage.getItem(k)]))})`);
  const ref = await json(label, value); report.storageSnapshots.push({ label, ...value, evidence: ref }); return value;
}
async function advance() {
  check('functional advances occur only while visible', !hiddenPhase && (await probe())?.state === 'visible');
  const row = { milliseconds: 0, hostStartMs: performance.now() - started, completed: false };
  report.functionalAdvanceCalls.push(row);
  const result = await evaluate('window.__npcAdvance(0)', gameSession, true);
  Object.assign(row, { completed: true, ...result, hostEndMs: performance.now() - started });
  check('functional advance preserves exact zero elapsed time', result.afterAt === result.beforeAt, row);
}
async function card() {
  return evaluate(`(() => {const rows=document.querySelectorAll('[data-bind="ucard-small_cargo"]');if(rows.length!==1)return{count:rows.length};const e=rows[0];return{count:1,html:e.outerHTML,input:e.querySelector('[data-bind="uqty-small_cargo"]').value,inputDisabled:e.querySelector('[data-bind="uqty-small_cargo"]').disabled,quote:e.querySelector('[data-bind="uquote-small_cargo"]').textContent,total:e.querySelector('[data-bind="utotal-small_cargo"]').textContent,payDisabled:e.querySelector('[data-action="manual-unit-pay"]').disabled,modes:[...e.querySelectorAll('[data-action="manual-unit-mode"]')].map(b=>({mode:b.dataset.mode,pressed:b.getAttribute('aria-pressed')}))};})()`);
}
async function geometry(selector) {
  return evaluate(`(() => {const selector=${JSON.stringify(selector)},rows=document.querySelectorAll(selector);if(rows.length!==1)return{selector,count:rows.length};const e=rows[0],r=e.getBoundingClientRect(),s=getComputedStyle(e),header=document.querySelector('.topbar');
    const points=[[r.x+3,r.y+3],[r.right-3,r.y+3],[r.x+3,r.bottom-3],[r.right-3,r.bottom-3],[r.x+r.width/2,r.y+r.height/2]].map(([x,y])=>{const hit=document.elementFromPoint(x,y);return{x,y,unoccluded:!!hit&&(hit===e||e.contains(hit)),hit:hit?{tag:hit.tagName,id:hit.id}:null};});
    return{selector,count:rows.length,rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},viewport:{width:innerWidth,height:innerHeight},
      visible:r.width>6&&r.height>6&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0,contained:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,
      disabled:!!e.disabled,points,headerBottom:header&&!header.contains(e)&&['sticky','fixed'].includes(getComputedStyle(header).position)?Math.max(0,header.getBoundingClientRect().bottom):0};})()`);
}
const hittable = g => g.count === 1 && g.visible && g.contained && g.points?.length === 5 && g.points.every(p => p.unoccluded);
async function settled(selector) {
  const began = performance.now(), samples = []; let previous, identical = 0, stableHost, stableNative;
  report.scrollSamples.push({ selector, samples });
  for (let attempt = 0; attempt < 33 && performance.now() - began < 1_600; attempt++) {
    const wait = Math.max(1, Math.min(250, 1_600 - (performance.now() - began)));
    const current = await evaluate(`window.__npcObserveFrame(${JSON.stringify({ selector, timeoutMs: wait })})`, gameSession, true);
    const now = performance.now(); current.hostOffsetMilliseconds = now - began; samples.push(current);
    const fresh = !current.observerTimedOut && current.nativeFrameTimestamp !== null && (!previous || current.nativeFrameSequence > previous.nativeFrameSequence && current.nativeFrameTimestamp > previous.nativeFrameTimestamp && current.controlledElapsed === previous.controlledElapsed);
    check('native scroll sample has fresh native frame and unchanged functional time', fresh && !!current.geometry.rect, current);
    if (previous && isDeepStrictEqual(previous.geometry, current.geometry)) identical++;
    else { identical = 1; stableHost = now; stableNative = current.nativeFrameTimestamp; }
    if (identical >= 4 && now - stableHost >= 150 && current.nativeFrameTimestamp - stableNative >= 150 && now - began <= 1_600) {
      check('native scroll geometry settles across four frames and 150ms within 1600ms', true, { selector, identical, hostSpan: now - stableHost, nativeSpan: current.nativeFrameTimestamp - stableNative }); return;
    }
    previous = current; await delay(Math.min(50, Math.max(0, 1_600 - (performance.now() - began))));
  }
  check('native scroll settles within 1600ms', false, await json('unsettled-scroll', { selector, samples }));
}
async function expose(selector) {
  await settled(selector);
  for (let attempt = 0; attempt < 5; attempt++) {
    const g = await geometry(selector);
    check('click target is unique and fits the real viewport', g.count === 1 && g.rect.height <= g.viewport.height && g.rect.width <= g.viewport.width, g);
    if (hittable(g)) return g;
    const available = g.viewport.height - g.headerBottom;
    check('click target fits the unobstructed viewport', g.rect.height <= available, g);
    const deltaY = Math.round(g.rect.y - (g.headerBottom + (available - g.rect.height) / 2));
    report.actions.push({ kind: 'native-wheel', selector, deltaY, before: g, hostMono: performance.now() - started });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.viewport.width - 12, y: g.viewport.height - 12 }, gameSession);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: g.viewport.width - 12, y: g.viewport.height - 12, deltaX: 0, deltaY }, gameSession);
    await advance(); await settled(selector);
  }
  check('native wheel exposes all five target points', false, await geometry(selector));
}
async function click(selector) {
  await expose(selector); const g = await geometry(selector), before = await probe();
  const proof = await json('before-native-click', { selector, geometry: g, before });
  check('native click target has five visible unoccluded points and is enabled', hittable(g) && !g.disabled, proof);
  const x = g.rect.x + g.rect.width / 2, y = g.rect.y + g.rect.height / 2;
  report.actions.push({ kind: 'native-click', selector, x, y, hostMono: performance.now() - started, beforeSequence: before.seq });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, gameSession);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, gameSession);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, gameSession);
  await advance(); const after = await probe(), events = after.clicks.filter(e => e.seq > before.seq);
  const ref = await json('after-native-click', { selector, events, after, storage: await storage('native-click-storage') });
  check('each native click produces exactly one trusted button event', after.id === before.id && events.length === 1 && events[0].trusted, ref);
}
async function tab(name) {
  const modal = await evaluate(`(() => {const e=document.querySelector('[data-bind="offline-modal"]');if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return !e.hidden&&s.display!=='none'&&s.visibility==='visible'&&r.width>0&&r.height>0;})()`);
  if (modal) await click('[data-action="dismiss-offline"]');
  await click(`[data-tab="${name}"]`);
}
async function realSave(label, expected) {
  await tab('save'); await click('[data-action="save"]');
  const observed = await storage(label), raw = observed.local[input.key], envelope = JSON.parse(raw);
  const ref = await json(label + '-entire-state', { raw, envelope, expected, excludedFields: [] });
  check(label + ': real Save witnesses exact entire current state', envelope.schema === 'infinity-original-p4' && envelope.version === 9 && envelope.revision === 16 && isDeepStrictEqual(envelope.state, expected), ref);
  return { raw, state: envelope.state, envelope, storage: observed, evidence: ref };
}
async function bodyOf(response, label) {
  await poll('complete response body ' + response.url, () => loads.has(response.requestId));
  const result = await cdp.send('Network.getResponseBody', { requestId: response.requestId }, gameSession);
  const body = Buffer.from(result.body, result.base64Encoded ? 'base64' : 'utf8');
  return { body, ref: await bytes(label, body), sha256: digest(body) };
}
async function bindProduction() {
  const rows = [], bodies = new Map(), executed = [];
  for (const r of responses.filter(r => r.app && ['Script', 'Stylesheet'].includes(r.type))) {
    const b = await bodyOf(r, 'http-asset'), name = r.url.slice(input.url.length);
    rows.push({ url: r.url, requestURL: requests.get(r.requestId)?.url, status: r.status, kind: r.type.toLowerCase(), name, sha256: b.sha256, expected: report.releaseMetadata.files[name], body: b.ref });
    bodies.set(r.url, b.sha256);
  }
  for (const event of scripts.filter(r => r.app && /^https?:/.test(r.url))) {
    const result = await cdp.send('Debugger.getScriptSource', { scriptId: event.scriptId }, gameSession), body = Buffer.from(result.scriptSource);
    const name = event.url.slice(input.url.length);
    executed.push({ url: event.url, scriptId: event.scriptId, sha256: digest(body), httpSha256: bodies.get(event.url) || null, expected: report.releaseMetadata.files[name], body: await bytes('v8-source', body, 'js') });
  }
  const documentResponse = responses.findLast(r => r.app && r.type === 'Document' && r.url === input.url);
  check('actual app document response was captured', !!documentResponse);
  const b = await bodyOf(documentResponse, 'http-document');
  const document = { url: documentResponse.url, requestURL: requests.get(documentResponse.requestId)?.url, status: documentResponse.status, sha256: b.sha256, expected: report.releaseMetadata.files['index.html'], body: b.ref };
  const value = { assets: rows, executed, document }; report.sourceBindings.push(value);
  const ref = await json('complete-production-binding', value);
  check('original HTTP200 document and full JS CSS bytes match release', document.url === input.url && document.requestURL === input.url && document.status === 200 && document.sha256 === document.expected && rows.some(r => r.kind === 'script') && rows.some(r => r.kind === 'stylesheet') && rows.every(r => r.status === 200 && r.url === r.requestURL && r.sha256 === r.expected), ref);
  check('actual V8 executed sources match original HTTP bytes and release', executed.length > 0 && executed.every(r => r.sha256 === r.httpSha256 && r.sha256 === r.expected), ref);
  const all = [], queue = Object.entries(report.releaseMetadata.files);
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      guard(); const [name, expected] = queue.shift(), url = new URL(name, input.url).href;
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([workAbort.signal, AbortSignal.timeout(remaining())]) });
      const body = Buffer.from(await response.arrayBuffer());
      all.push({ name, url: response.url, requestURL: url, status: response.status, sha256: digest(body), expected, body: await bytes('release-resource', body) });
    }
  }));
  all.sort((a, b) => a.name.localeCompare(b.name)); report.releaseResources = all;
  const allRef = await json('all-release-resources-http', all);
  check('all 62 release resources actual HTTP200 full hashes match', all.length === 62 && all.every(r => r.status === 200 && r.url === r.requestURL && r.sha256 === r.expected), allRef);
  await cdp.send('Debugger.disable', {}, gameSession);
}
async function executable() {
  const names = input.chromium ? [input.chromium] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const name of names) for (const path of name.includes('/') ? [resolve(name)] : (process.env.PATH || '').split(delimiter).map(dir => join(dir, name))) {
    try { await access(path, constants.X_OK); return path; } catch { /* Try next installed binary. */ }
  }
  throw new Error('Required installed Chromium binary is unavailable');
}
async function run() {
  const original = await readFile(values.input); input = JSON.parse(original);
  evidenceRoot = await realpath(resolve(input.evidenceRoot));
  const actualOutput = await realpath(output), rel = relative(evidenceRoot, actualOutput);
  check('output is an exclusive descendant of evidenceRoot', !!rel && !rel.startsWith('..' + sep) && !isAbsolute(rel));
  report.inputSha256 = digest(original); report.input = await bytes('input-original', original, 'json');
  report.sourceSha = input.expectedSha; report.version = input.expectedVersion;
  check('exact hidden helper input contract is supplied', input.schema === 'infinity-manual-unit-hidden-input-v1' && typeof input.initialRaw === 'string' && typeof input.clockScript === 'string' && typeof input.key === 'string' && !!input.beforeState && !!input.expectedState && !!input.expectedRelease && typeof input.expectedBrowserVersion === 'string' && typeof input.chromium === 'string');
  report.clockScript = await bytes('existing-functional-clock', input.clockScript, 'js');
  report.expected = { beforeState: input.beforeState, expectedState: input.expectedState, initialRaw: input.initialRaw };
  const app = new URL(input.url);
  check('acceptance uses local real HTTP', app.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(app.hostname) && app.href === input.url && input.url.endsWith('/'));
  check('headed display and built-in WebSocket are available', !!process.env.DISPLAY && typeof WebSocket === 'function');
  const bin = await executable(); guard();
  const createdProfile = await mkdtemp(join(tmpdir(), 'infinity-manual-hidden-'));
  if (stopping) { await rm(createdProfile, { recursive: true, force: true }); guard(); }
  profile = createdProfile; guard();
  const spawnArgs = [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--window-size=1440,1100', 'about:blank'];
  report.chrome = { executable: bin, spawnArgs, sandbox: 'unchanged native default', background: 'unchanged native default' };
  guard(); // Never launch a browser after a pending setup operation crossed the work deadline.
  chrome = spawn(bin, spawnArgs, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', chunk => { stderr += chunk.toString(); });
  exitPromise = new Promise(done => {
    chrome.once('error', error => { chromeExited = true; report.chrome.spawnError = String(error); done(); });
    chrome.once('exit', (code, signal) => { chromeExited = true; report.chrome.exit = { code, signal }; done(); });
  });
  const owner = { schema: 'infinity-manual-unit-hidden-owner-v1', nodePid: process.pid, parentPid: process.ppid, chromePid: chrome.pid, pgid: chrome.pid, profile, inputSha256: report.inputSha256 };
  const ownerBytes = Buffer.from(JSON.stringify(owner, null, 2) + '\n');
  const ownerPending = join(output, '.chrome-owner-pending.json'), ownerPath = join(output, 'chrome-owner.json');
  await writeFile(ownerPending, ownerBytes, { flag: 'wx' });
  await link(ownerPending, ownerPath); // Atomic exclusive publication: the parent never sees partial JSON.
  await unlink(ownerPending);
  report.chromeOwnership = { ...owner, evidence: { file: relative(evidenceRoot, join(output, 'chrome-owner.json')).split(sep).join('/'), sha256: digest(ownerBytes), bytes: ownerBytes.length } };
  const endpoint = await poll('owned Chrome DevToolsActivePort', async () => {
    if (chromeExited) throw new Error('Owned Chrome exited: ' + stderr);
    try { const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); return /^\d+$/.test(port) && Number(port) > 0 && Number(port) < 65536 && path?.startsWith('/devtools/browser/') ? `ws://127.0.0.1:${port}${path}` : null; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }, 10_000);
  cdp = await CDP.connect(endpoint);
  report.chrome.version = await cdp.send('Browser.getVersion');
  check('owned headed Chrome version exactly matches parent same binary', report.chrome.version.product === 'Chrome/' + input.expectedBrowserVersion, report.chrome);
  const targets = await cdp.send('Target.getTargets'); gameTarget = targets.targetInfos.find(t => t.type === 'page' && t.url === 'about:blank')?.targetId;
  check('owned initial ordinary game target exists', !!gameTarget);
  ({ sessionId: gameSession } = await cdp.send('Target.attachToTarget', { targetId: gameTarget, flatten: true }));
  cdp.onEvent = ({ method, params, sessionId }) => {
    if (sessionId !== gameSession) return;
    const hostWall = Date.now(), hostMono = performance.now() - started;
    if (method === 'Runtime.bindingCalled' && params.name === binding) {
      try { report.lifecycle.push({ ...JSON.parse(params.payload), hostWall, hostMono, deliverySequence: report.lifecycle.length + 1 }); }
      catch (error) { report.errors.push({ kind: 'binding-json', error: String(error) }); }
    } else if (method === 'Network.requestWillBeSent') { requests.set(params.requestId, params.request); report.requests.push({ method, ...params, hostMono }); }
    else if (method === 'Network.responseReceived') responses.push({ requestId: params.requestId, ...params.response, type: params.type, app: appNavigated });
    else if (method === 'Network.loadingFinished') loads.add(params.requestId);
    else if (method === 'Debugger.scriptParsed') scripts.push({ ...params, app: appNavigated });
    else if (method === 'Runtime.exceptionThrown') report.errors.push({ kind: 'page-exception', details: params.exceptionDetails, hostMono });
    else if (method === 'Network.loadingFailed' && !params.canceled) report.errors.push({ kind: 'network-failure', details: params, hostMono });
  };
  for (const method of ['Page.enable', 'Runtime.enable', 'DOMStorage.enable', 'Network.enable', 'Debugger.enable']) await cdp.send(method, {}, gameSession);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, gameSession);
  const releaseURL = new URL('release.json', input.url).href;
  await cdp.send('Page.navigate', { url: releaseURL }, gameSession);
  const response = await poll('actual same-origin release document', () => responses.find(r => r.type === 'Document' && r.url === releaseURL));
  const releaseBody = await bodyOf(response, 'http-release'); report.releaseMetadata = JSON.parse(releaseBody.body.toString('utf8')); report.releaseBody = releaseBody.ref;
  check('actual release pins exact SHA version v9r16 and identical parent metadata', response.status === 200 && requests.get(response.requestId)?.url === releaseURL && report.releaseMetadata.sourceSha === input.expectedSha && report.releaseMetadata.version === input.expectedVersion && report.releaseMetadata.saveVersion === 9 && report.releaseMetadata.saveRevision === 16 && Object.keys(report.releaseMetadata.files || {}).length === 62 && isDeepStrictEqual(report.releaseMetadata, input.expectedRelease), releaseBody.ref);
  check('all release file names remain in the exact app base', Object.keys(report.releaseMetadata.files).every(name => name && !name.startsWith('/') && !name.split('/').includes('..') && new URL(name, input.url).href.startsWith(input.url)));
  await poll('same-origin release document ready for storage', async () => await evaluate('location.href') === releaseURL);
  const storageId = { securityOrigin: app.origin, isLocalStorage: true };
  await cdp.send('DOMStorage.clear', { storageId }, gameSession);
  await cdp.send('DOMStorage.setDOMStorageItem', { storageId, key: input.key, value: input.initialRaw }, gameSession);
  await cdp.send('DOMStorage.setDOMStorageItem', { storageId, key: 'infinity.ui.tab', value: 'overview' }, gameSession);
  const seeded = await cdp.send('DOMStorage.getDOMStorageItems', { storageId }, gameSession), cookies = await cdp.send('Network.getCookies', { urls: [input.url] }, gameSession);
  report.seed = { entries: seeded.entries, cookies: cookies.cookies, initialRaw: input.initialRaw };
  const seedRef = await json('anonymous-native-origin-seed', report.seed);
  check('anonymous profile seeds only original raw and overview with exact byte readback', cookies.cookies.length === 0 && isDeepStrictEqual(Object.fromEntries(seeded.entries), { [input.key]: input.initialRaw, 'infinity.ui.tab': 'overview' }), seedRef);
  await cdp.send('Runtime.addBinding', { name: binding }, gameSession);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: diagnostics(input.key) + '\n' + input.clockScript }, gameSession);
  appNavigated = true; await cdp.send('Page.navigate', { url: input.url }, gameSession);
  const ready = await poll('actual visible production document', async () => { try { const p = await probe(); return p?.ready && p.href === input.url && !p.hidden && p.state === 'visible' ? p : null; } catch (error) { if (/Cannot find context|Execution context was destroyed/.test(String(error))) return null; throw error; } }, 8_000);
  report.initial = ready;
  check('app initial original raw is byte-identical and native APIs are intact', ready.initialRaw === input.initialRaw && Object.values(ready.initialAPIs).every(Boolean) && Object.values(ready.native).every(Boolean), await json('initial-native-production', ready));
  await advance(); await bindProduction();
  report.beforeSave = await realSave('before-payment', input.beforeState);
  await tab('shipyard'); await click('[data-action="manual-unit-mode"][data-id="small_cargo"][data-mode="count"]');
  const beforePay = await storage('before-payment-storage'), quoted = await card(), planet = input.beforeState.planets.find(p => p.id === input.beforeState.activePlanetId), coords = planet.coordinates;
  report.beforePayment = { raw: beforePay.local[input.key], card: quoted, state: JSON.parse(beforePay.local[input.key]).state, storage: beforePay };
  const quoteRef = await json('independent-golden-quote', { ...report.beforePayment, expectedPrice: { metal: '2000', crystal: '2000', deuterium: '0' } });
  check('default one count quote displays independent golden full 2000M 2000C 0D', quoted.count === 1 && quoted.input === '1' && !quoted.inputDisabled && !quoted.payDisabled && quoted.total === '金属 2,000 · 晶体 2,000 · 重氢 0' && quoted.modes.find(m => m.mode === 'count')?.pressed === 'true' && quoted.quote.includes(planet.name) && quoted.quote.includes(`[${coords.galaxy}:${coords.system}:${coords.position}]`) && quoted.quote.includes('本次新增 1'), quoteRef);
  check('mode selection leaves every saved state field unchanged before separate payment', isDeepStrictEqual(report.beforePayment.state, input.beforeState), quoteRef);
  await click('[data-bind="upay-small_cargo"]');
  const paidStorage = await storage('after-payment-storage'), paidRaw = paidStorage.local[input.key], paidEnvelope = JSON.parse(paidRaw), paidCard = await card();
  report.afterPayment = { raw: paidRaw, envelope: paidEnvelope, state: paidEnvelope.state, card: paidCard, storage: paidStorage };
  const paidRef = await json('complete-after-payment', { ...report.afterPayment, expected: input.expectedState });
  check('one real payment produces exact complete expected state', isDeepStrictEqual(paidEnvelope.state, input.expectedState), paidRef);
  const paidPlanet = paidEnvelope.state.planets.find(p => p.id === planet.id), job = paidPlanet.shipyardQueue.at(-1), prices = { metal: '2000', crystal: '2000', deuterium: '0' };
  const literal = structuredClone(input.beforeState), target = literal.planets.find(p => p.id === planet.id);
  target.resources = Object.fromEntries(Object.keys(planet.resources).map(k => [k, prices[k] === undefined ? planet.resources[k] : String(BigInt(planet.resources[k]) - BigInt(prices[k]))]));
  target.shipyardQueue.push(job); literal.orders.nextJobId++; literal.stats.manualActions++;
  check('literal golden debit appends one stable manual job and changes no other field', isDeepStrictEqual(paidEnvelope.state, literal) && job.unit === 'small_cargo' && job.count === 1 && job.orderedCount === 1 && job.jobId === input.beforeState.orders.nextJobId && job.source === 'manual' && job.taskId === null && isDeepStrictEqual(job.paidPerUnit, prices), paidRef);
  check('successful payment consumes quote and retains raw default one', paidCard.payDisabled && paidCard.input === '1', paidRef);
  const beforeCover = await probe();
  ({ targetId: coverTarget } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: false, background: true }));
  ({ sessionId: coverSession } = await cdp.send('Target.attachToTarget', { targetId: coverTarget, flatten: true }));
  await cdp.send('Runtime.enable', {}, coverSession);
  const gameWindow = await cdp.send('Browser.getWindowForTarget', { targetId: gameTarget }), coverWindow = await cdp.send('Browser.getWindowForTarget', { targetId: coverTarget });
  const coverBefore = await evaluate('({hidden:document.hidden,state:document.visibilityState,href:location.href})', coverSession), gameBefore = await probe();
  report.windows = { game: gameWindow, cover: coverWindow, gameTarget, coverTarget }; report.beforeHide = gameBefore; report.coverBefore = coverBefore;
  check('cover is a distinct background tab in the same headed window while game stays visible', gameTarget !== coverTarget && gameWindow.windowId === coverWindow.windowId && !gameBefore.hidden && gameBefore.state === 'visible' && coverBefore.hidden && coverBefore.state === 'hidden' && beforeCover.id === gameBefore.id, await json('native-background-tabs', { windows: report.windows, gameBefore, coverBefore }));
  hiddenPhase = true;
  await phase('native hidden transition', 5_000, async () => {
    report.actions.push({ kind: 'activate-cover', targetId: coverTarget, beforeSequence: gameBefore.seq, hostMono: performance.now() - started });
    await cdp.send('Target.activateTarget', { targetId: coverTarget });
    report.hidden = await poll('trusted subsequent native hidden event', async () => { const p = await probe(); return p.id === gameBefore.id && p.hidden && p.state === 'hidden' && p.events.some(e => e.seq > gameBefore.seq && e.type === 'visibilitychange' && e.trusted && e.hidden && e.state === 'hidden') ? p : null; });
  });
  report.coverHidden = await evaluate('({hidden:document.hidden,state:document.visibilityState})', coverSession);
  check('cover is genuinely visible during original game hidden interval', !report.coverHidden.hidden && report.coverHidden.state === 'visible', report.coverHidden);
  report.hiddenEvent = report.hidden.events.find(e => e.seq > gameBefore.seq && e.type === 'visibilitychange' && e.trusted && e.hidden && e.state === 'hidden');
  const hiddenRef = await json('native-hidden', report.hidden);
  check('native hidden getter and trusted later hidden event are established without emulation', Object.values(report.hidden.native).every(Boolean) && report.hiddenEvent.seq > gameBefore.seq, hiddenRef);
  await phase('native visible resume', 5_000, async () => {
    report.actions.push({ kind: 'activate-game', targetId: gameTarget, beforeSequence: report.hidden.seq, hostMono: performance.now() - started });
    await cdp.send('Target.activateTarget', { targetId: gameTarget });
    report.resumed = await poll('strictly later trusted visible event in same document', async () => { const p = await probe(); return p.id === report.hidden.id && !p.hidden && p.state === 'visible' && p.events.some(e => e.seq > report.hidden.seq && e.type === 'visibilitychange' && e.trusted && !e.hidden && e.state === 'visible') ? p : null; });
  });
  report.resumedEvent = report.resumed.events.find(e => e.seq > report.hidden.seq && e.type === 'visibilitychange' && e.trusted && !e.hidden && e.state === 'visible');
  hiddenPhase = false;
  check('trusted visible event strictly follows hidden event in the same original document', report.initial.id === report.hidden.id && report.hidden.id === report.resumed.id && report.resumedEvent.seq > report.hiddenEvent.seq && report.resumedEvent.nativeMono > report.hiddenEvent.nativeMono && Object.values(report.resumed.native).every(Boolean), await json('native-visible-resume', report.resumed));
  await advance(); report.afterResumeCard = await card();
  check('actual hidden resume cannot resurrect a consumed payment', report.afterResumeCard.payDisabled && report.afterResumeCard.input === '1', await json('consumed-after-resume', report.afterResumeCard));
  report.finalSave = await realSave('hidden-resume-entire-state', input.expectedState);
  report.finalProbe = await probe();
  report.originalClockObservers = await evaluate('({native:window.__npcNative,clicks:window.__npcClicks,edits:window.__npcEdits,wheels:window.__npcWheels,storage:window.__npcStorage})');
  check('original CLOCK preserves native APIs and records one trusted payment without editing default one', report.originalClockObservers.native === true && report.originalClockObservers.clicks.filter(e => e.action === 'manual-unit-pay').length === 1 && report.originalClockObservers.clicks.every(e => e.trusted) && report.originalClockObservers.edits.length === 0 && report.originalClockObservers.wheels.every(e => e.trusted), await json('original-clock-observers', report.originalClockObservers));
  check('exactly one trusted payment and no untrusted button input occurred', report.finalProbe.clicks.filter(e => e.action === 'manual-unit-pay').length === 1 && report.finalProbe.clicks.every(e => e.trusted), await json('final-native-events', report.finalProbe));
  check('no document replacement or reload occurred during hidden and resume', report.finalProbe.id === report.initial.id && !report.finalProbe.events.some(e => ['pagehide', 'beforeunload'].includes(e.type)), report.finalProbe.id);
  check('all successful functional advances are zero-time and no browser failures occurred', report.functionalAdvanceCalls.length > 0 && report.functionalAdvanceCalls.every(r => r.completed && r.milliseconds === 0 && r.afterAt === r.beforeAt) && report.errors.length === 0, { functionalAdvanceCalls: report.functionalAdvanceCalls, errors: report.errors });
  check('success screenshot is taken only after genuinely visible resume', !report.finalProbe.hidden && report.finalProbe.state === 'visible');
  const capture = await cdp.send('Page.captureScreenshot', { format: 'png' }, gameSession); report.screenshot = await bytes('visible-final', Buffer.from(capture.data, 'base64'), 'png');
  guard(); report.completed = true; report.result = 'passed';
}
async function failureCapture() {
  if (!cdp || !gameSession || cdp.closed) return;
  failureCaptureUntil = Math.min(wholeDeadline - 3_000, performance.now() + 2_000);
  try {
    report.failureSnapshot = await evaluate(`({probe:window.__manualNativeHiddenProbe?.snapshot()??null,hidden:document.hidden,state:document.visibilityState,href:location.href,html:document.documentElement.outerHTML,local:Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])),session:Object.fromEntries(Object.keys(sessionStorage).sort().map(k=>[k,sessionStorage.getItem(k)])),clicks:window.__npcClicks??null,wheels:window.__npcWheels??null})`, gameSession, false, true);
    report.failureSnapshotEvidence = await json('live-failure-snapshot', report.failureSnapshot);
    if (!report.failureSnapshot.hidden && report.failureSnapshot.state === 'visible') {
      const capture = await cdp.send('Page.captureScreenshot', { format: 'png' }, gameSession, true);
      report.failureScreenshot = await bytes('visible-failure', Buffer.from(capture.data, 'base64'), 'png');
    } else report.failureScreenshotSkipped = 'Hidden document: no screenshot or activation';
  } catch (error) { report.failureCaptureError = String(error); }
}

async function cleanup() {
  stopping = true;
  if (cdp) report.cleanup.socketClosed = await cdp.close(); else report.cleanup.socketClosed = true;
  const groupAlive = signal => {
    if (!chrome?.pid) return false;
    try { process.kill(-chrome.pid, signal); return true; }
    catch (error) { if (error.code !== 'ESRCH') report.cleanup.error = String(error); return false; }
  };
  if (chrome?.pid) {
    report.cleanup.pid = chrome.pid; report.cleanup.termSent = groupAlive('SIGTERM');
    let until = Math.min(wholeDeadline - 900, performance.now() + 800);
    while (performance.now() < until && groupAlive(0)) await delay(40);
    if (groupAlive(0)) { report.cleanup.killSent = groupAlive('SIGKILL'); until = Math.min(wholeDeadline - 600, performance.now() + 800); while (performance.now() < until && groupAlive(0)) await delay(40); }
    if (!chromeExited) await Promise.race([exitPromise, delay(Math.max(1, Math.min(500, wholeDeadline - performance.now() - 500)))]);
  }
  report.cleanup.processExited = !chrome || chromeExited;
  report.cleanup.processGroupGone = !groupAlive(0);
  if (profile) { try { await rm(profile, { recursive: true, force: true, maxRetries: 1, retryDelay: 50 }); report.cleanup.profileRemoved = true; } catch (error) { report.cleanup.error = String(error); } }
  else report.cleanup.profileRemoved = true;
  const okay = report.cleanup.socketClosed && report.cleanup.processExited && report.cleanup.processGroupGone && report.cleanup.profileRemoved && !report.cleanup.error;
  report.checks.push({ name: 'owned CDP socket process group process exit and temporary profile fully cleaned', passed: !!okay, detail: { ...report.cleanup } });
  if (!okay) { report.completed = false; report.result = 'failed'; report.failure ||= { message: 'Owned Chrome cleanup incomplete' }; }
}
try {
  runPromise = run();
  await Promise.race([runPromise, new Promise((_, reject) => { deadlineTimer = setTimeout(() => { stopping = true; workAbort.abort(); cdp?.rejectPending(new Error('39s work deadline')); reject(new Error('39s work deadline; capture and cleanup within 45s')); }, Math.max(1, workDeadline - performance.now())); })]);
} catch (error) {
  clearTimeout(deadlineTimer); // Do not let the work timer cancel bounded live failure diagnostics.
  report.completed = false; report.result = 'failed'; report.failure = { message: String(error), stack: error.stack };
  stopping = true; workAbort.abort(); cdp?.rejectPending(new Error('Run stopped for failure capture'));
  await Promise.race([runPromise?.catch(() => {}), delay(200)]);
  await failureCapture();
} finally {
  clearTimeout(deadlineTimer);
  try { await cleanup(); } catch (error) { report.completed = false; report.result = 'failed'; report.cleanup.error = String(error); report.failure ||= { message: String(error) }; }
  report.finishedAt = Date.now(); report.durationMs = performance.now() - started;
  if (report.durationMs >= 45_000) { report.completed = false; report.result = 'failed'; report.failure ||= { message: 'Whole helper exceeded 45s' }; }
  report.passed = report.checks.filter(row => row.passed).length;
  await writeFile(join(output, 'chrome-stderr.log'), stderr, { flag: 'wx' });
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.exitCode = report.completed ? 0 : 1;
  console.log(JSON.stringify({ completed: report.completed, result: report.result, checks: report.checks.length, durationMs: report.durationMs, output, failure: report.failure }));
}
