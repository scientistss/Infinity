"""Natural ring milestones continued through the real HTTP UI, never a rich fixture.

Input is a passed infinity-natural-ring-journey-v1 report generated against the
same save revision as the pinned release. Immutable milestone saves are read by
native File.text and explicitly confirmed, then persisted in native localStorage.

Manual 9 -> 10 animation cases use native performance/RAF/timers and real elapsed
browser time (Date.now alone is aligned to the source envelope epoch). Exact
finite-batch/stop/curvature cases explicitly control Date/performance/RAF timestamp
values, retaining native RAF dispatch and timers, and advance only one live second
per step. No game state, resource, count, RNG or Storage function is patched.
These are local browser continuations of a time-compressed domain journey, not a
continuous seven-hour human session, physical mobile test or background-throttling
claim. The Linux supervisor owns and verifies PID/start-time pairs, including
Chromium descendants that detach from the worker's process group.
"""
import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import time
import traceback
import uuid
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse


REPORT_NAME = 'natural-ring-browser-report.json'
WORK_SECONDS, SUPERVISOR_SECONDS = 210, 225
WIDTHS = (320, 390, 1440)
NAMES = {
    'nine': '06-nine-manual-locked-with-tenth-ticket-ready',
    'ten': '07-ten-manual-card-unlocked',
    'equipped': '08-equipped-off-current-three-tickets',
    'toggle': '09-toggle-alone-cannot-spend',
    'armed': '10-armed-two-existing-tickets-fixed-home-source',
    'partial': '11-armed-one-remaining-strict-save-reload',
    'future': '12-completed-prefix-future-ticket-not-consumed',
    'before_stop': '13-armed-before-explicit-stop',
    'stopped': '14-stopped-unspent-existing-tickets',
    'before_curvature': '15-before-curvature-active-batch-one-remaining',
    'after_curvature': '16-after-curvature-old-batch-and-slot-disabled',
    'post_curvature': '17-post-curvature-natural-beacon-cannot-resume-old-authority',
}


def sha(value):
    return hashlib.sha256(value.encode('utf-8') if isinstance(value, str) else value).hexdigest()


def atomic_json(path, value):
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def process_identity(pid):
    try:
        values = Path(f'/proc/{pid}/stat').read_text().rsplit(') ', 1)[1].split()
        return {'pid': pid, 'startTimeTicks': values[19], 'state': values[0]}
    except (OSError, IndexError):
        return None


def supervise(args):
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise SystemExit('Use an empty --output directory; stale evidence must not be mixed into this run.')
    if sys.platform != 'linux' or not Path('/proc/self/stat').is_file():
        raise SystemExit('This bounded supervisor requires Linux /proc PID/start-time evidence.')
    report_path = out / REPORT_NAME
    atomic_json(report_path, {'completed': False, 'result': 'starting', 'checks': []})
    marker = '--natural-ring-owner=' + uuid.uuid4().hex
    owned, signals = {}, []

    def collect(root):
        # The exact unique launch marker finds the browser root even if it has
        # reparented before the next ancestry scan. Never match process names.
        pending = [root, *owned]
        for entry in Path('/proc').iterdir():
            if not entry.name.isdigit():
                continue
            try:
                if marker.encode() in (entry / 'cmdline').read_bytes().split(b'\0'):
                    pending.append(int(entry.name))
            except OSError:
                pass
        visited = set()
        while pending:
            pid = pending.pop()
            if pid in visited:
                continue
            visited.add(pid)
            identity = process_identity(pid)
            if identity is None or (pid in owned and identity['startTimeTicks'] != owned[pid]['startTimeTicks']):
                continue
            owned.setdefault(pid, {**identity, 'firstObservedHostTime': time.time()})
            for children in Path(f'/proc/{pid}/task').glob('*/children'):
                try:
                    pending.extend(int(value) for value in children.read_text().split())
                except OSError:
                    pass
        # The worker supplements the ancestry scan with Chromium's own actual
        # process list. Identity is checked again before collection and signaling.
        registry = out / 'chromium-processes.json'
        if registry.is_file():
            try:
                for identity in json.loads(registry.read_text()):
                    current = process_identity(identity['pid'])
                    if current and current['startTimeTicks'] == identity['startTimeTicks']:
                        owned.setdefault(identity['pid'], {**identity, 'via': 'CDP SystemInfo.getProcessInfo'})
            except (OSError, ValueError, KeyError):
                pass

    def terminate(sig):
        for pid, recorded in reversed(list(owned.items())):
            current = process_identity(pid)
            if current and current['startTimeTicks'] == recorded['startTimeTicks'] and current['state'] != 'Z':
                try:
                    os.kill(pid, sig)
                    signals.append({'pid': pid, 'startTimeTicks': current['startTimeTicks'], 'signal': sig})
                except ProcessLookupError:
                    pass

    def supervisor_interrupted(signum, _frame):
        raise KeyboardInterrupt(f'Supervisor received signal {signum}')

    signal.signal(signal.SIGTERM, supervisor_interrupted)
    expired, interrupted, code = False, None, 1
    with (out / 'worker.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:],
                                    '--worker', '--owner-marker=' + marker], stdout=log,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + SUPERVISOR_SECONDS
        try:
            while True:
                collect(process.pid)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    expired = True
                    break
                try:
                    code = process.wait(timeout=min(.2, remaining))
                    break
                except subprocess.TimeoutExpired:
                    pass
        except BaseException as error:
            interrupted = repr(error)
        finally:
            collect(process.pid)
            terminate(signal.SIGTERM)
            until = time.monotonic() + 2
            while time.monotonic() < until:
                collect(process.pid)
                if all((process_identity(pid) or {}).get('state', 'Z') == 'Z' for pid in owned):
                    break
                time.sleep(.1)
            terminate(signal.SIGKILL)
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                code = 1
            time.sleep(.1)
    survivors = []
    for pid, recorded in owned.items():
        current = process_identity(pid)
        if current and current['startTimeTicks'] == recorded['startTimeTicks'] and current['state'] != 'Z':
            survivors.append(current)
    try:
        result = json.loads(report_path.read_text())
    except (OSError, ValueError) as error:
        result = {'completed': False, 'result': 'missing or invalid worker report', 'error': repr(error)}
    result['supervisor'] = {'boundSeconds': SUPERVISOR_SECONDS, 'expired': expired,
                            'interrupted': interrupted, 'workerPid': process.pid,
                            'workerExitCode': process.returncode, 'ownedProcesses': list(owned.values()),
                            'signals': signals, 'survivors': survivors,
                            'scope': 'Only actual descendants, exact unique Chromium marker and CDP processes, with PID/start-time revalidation; no pkill or broad group cleanup.'}
    if expired or interrupted or survivors or code != 0 or process.returncode != 0:
        result.update(completed=False, result='failed or incomplete')
    atomic_json(report_path, result)
    passed = result.get('completed') and result.get('result') == 'passed'
    print(json.dumps({'completed': bool(passed), 'result': result.get('result'),
                      'checks': len(result.get('checks', [])), 'report': str(report_path)}, ensure_ascii=False))
    return 0 if passed else 1


# Only clocks/observation are installed, and only on the tested HTTP origin.
# This guard must precede sessionStorage: init scripts also see about:blank.
CLOCK = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const nativeNow=performance.now.bind(performance), nativeRAF=window.requestAnimationFrame.bind(window);
 const start=nativeNow(), prior=sessionStorage.getItem('natural-ring-clock');
 const epoch=prior===null?__EPOCH__:Number(prior), controlled=__CONTROLLED__;
 let elapsed=0;
 Date.now=()=>epoch+(controlled?elapsed:nativeNow()-start);
 if(controlled){
  Object.defineProperty(performance,'now',{value:()=>elapsed});
  window.requestAnimationFrame=callback=>nativeRAF(()=>callback(elapsed));
 }
 const native=fn=>/\[native code\]/.test(Function.prototype.toString.call(fn));
 const probe={events:[],files:[],imports:[],animation:[],advances:[],controlled,
  integrity:()=>({localStorage:localStorage instanceof Storage,
   storageGet:native(Storage.prototype.getItem),storageSet:native(Storage.prototype.setItem),
   storageRemove:native(Storage.prototype.removeItem),storageClear:native(Storage.prototype.clear),
   fileText:native(File.prototype.text),confirm:native(window.confirm),
   setTimeout:native(window.setTimeout),setInterval:native(window.setInterval),
   performanceNow:native(performance.now),raf:native(window.requestAnimationFrame)}),
  clock:()=>({dateNow:Date.now(),performanceNow:performance.now(),nativePerformanceNow:nativeNow(),controlled})};
 window.__naturalRing=probe;
 window.__naturalRingStep=async ms=>{
  if(!controlled || !Number.isInteger(ms) || ms<0 || ms>1000)throw Error('Only explicit 0–1000ms controlled live steps allowed');
  elapsed+=ms;sessionStorage.setItem('natural-ring-clock',String(Date.now()));
  probe.advances.push({milliseconds:ms,dateNow:Date.now(),hostPerformanceNow:nativeNow()});
  await new Promise(nativeRAF);await new Promise(nativeRAF);
 };
 window.addEventListener('beforeunload',()=>sessionStorage.setItem('natural-ring-clock',String(Date.now())));
 for(const type of ['click','input','change','keydown'])document.addEventListener(type,event=>{
  const target=event.target.closest?.('button,input,select,[data-tile]');
  if(target)probe.events.push({type,trusted:event.isTrusted,key:event.key??null,id:target.id,
   action:target.dataset.action??null,ring:target.dataset.ring??null,bind:target.dataset.bind??null,
   card:target.dataset.card??null,tab:target.dataset.tab??null,nativePerformanceNow:nativeNow()});
  if(type==='change' && target?.matches('[data-bind="import-file"]')){
   const file=target.files[0], row={name:file?.name,size:file?.size,trusted:event.isTrusted,
    beforeRaw:localStorage.getItem(__KEY__),text:null,error:null};
   probe.files.push(row);
   // Independent native read of the selected real File. Do not wrap, gate or
   // replace File.text; the pinned application's own import also calls it.
   if(file)file.text().then(raw=>{row.text=raw;},error=>{row.error=String(error);});
  }
 },true);
 let last='',lastStatus='';
 new MutationObserver(()=>{
  const status=document.querySelector('[data-bind="status"]')?.textContent??'';
  if(status!==lastStatus){lastStatus=status;if(status.includes('已导入并存入本地'))probe.imports.push({status,raw:localStorage.getItem(__KEY__),nativePerformanceNow:nativeNow()});}
  const title=document.querySelector('.ring-hero-title')?.textContent??null;
  const lit=[...document.querySelectorAll('.arcade-tile.lit')].map(node=>Number(node.dataset.tile));
  const value=JSON.stringify([title,lit]);
  if(value!==last){last=value;probe.animation.push({title,lit,nativePerformanceNow:nativeNow(),
   gamePerformanceNow:performance.now()});}
 }).observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']});
})();'''


def worker(args):
    from playwright.sync_api import expect, sync_playwright
    out = Path(args.output).resolve()
    started = time.monotonic()
    parsed = urlparse(args.url)
    origin = f'{parsed.scheme}://{parsed.netloc}'
    report = {
        'schema': 'infinity-natural-ring-browser-v1', 'completed': False, 'result': 'running',
        'startedAtHost': time.time(), 'url': args.url, 'expectedSourceSha': args.expected_sha,
        'scope': 'Local native-UI continuations of independently generated natural saves. No pre-funded fixture or game-state/resource/count/RNG/Storage-function patch.',
        'limitations': [
            'The domain report compresses counted one-second live ticks; this browser run does not replay several hours of human clicking.',
            'Manual animations use native performance/RAF/timers; Date.now is source-epoch aligned, so the entire clock environment is not wholly native.',
            'Finite automation and curvature use explicitly controlled simulation timestamps with native RAF dispatch and native timers; every positive step is one second.',
            '320/390/1440 are desktop Chromium CSS viewports, not physical mobile-device or background-throttling tests.',
            'Milestone imports are separate local handoffs. Native reload retains only an existing armed batch remainder; explicit stop/completion/curvature never grants renewed authority.',
            'An independent unwrapped native File.text read hashes selected bytes; the pinned production import path reads the same File, asks native confirm, and persists the complete adopted state.',
        ],
        'runtime': {'python': platform.python_version(), 'platform': platform.platform()},
        'boundsSeconds': {'work': WORK_SECONDS, 'supervisor': SUPERVISOR_SECONDS},
        'checks': [], 'stages': [], 'errors': [], 'failedRequests': [], 'sources': [],
        'http': [], 'scriptAssets': [], 'screenshots': [],
    }
    active = None
    browser = None
    release = None
    milestones = {}
    key = None
    case = 'source validation'

    def flush():
        report['elapsedHostSeconds'] = round(time.monotonic() - started, 3)
        report['activeCase'] = case
        report['passedChecks'] = sum(row['passed'] for row in report['checks'])
        atomic_json(out / REPORT_NAME, report)

    def check(name, condition, detail=None):
        row = {'case': case, 'name': name, 'passed': bool(condition)}
        if detail is not None:
            row['detail'] = detail
        report['checks'].append(row)
        flush()
        if not condition:
            raise AssertionError(f'{case}: {name}')

    def state(which):
        return milestones[which]['save']['state']

    def dump_bytes(name, content):
        data = content.encode('utf-8') if isinstance(content, str) else content
        (out / name).write_bytes(data)
        return {'file': name, 'sha256': sha(data), 'bytes': len(data)}

    def process_evidence():
        client = browser.new_browser_cdp_session()
        try:
            processes = client.send('SystemInfo.getProcessInfo')['processInfo']
            identities = [process_identity(int(item['id'])) for item in processes]
            prior_path = out / 'chromium-processes.json'
            previous = json.loads(prior_path.read_text()) if prior_path.exists() else []
            unique = {(row['pid'], row['startTimeTicks']): row for row in previous + [x for x in identities if x]}
            atomic_json(prior_path, list(unique.values()))
        finally:
            client.detach()

    class Stage:
        def __init__(self, name, source, width=1440, controlled=True):
            nonlocal active, case
            case = name
            self.source, self.controlled = source, controlled
            self.responses, self.executed = [], []
            self.verified = set()
            self.generation = 0
            self.context = self.page = self.cdp = None
            self.data = {'name': name, 'sourceMilestone': milestones[source]['name'],
                         'viewport': {'width': width, 'height': 1000},
                         'clockMode': 'controlled simulation timestamps / native RAF dispatch and timers' if controlled else 'native animation timing / Date.now source-epoch alignment',
                         'operations': [], 'snapshots': [], 'dialogs': [], 'completed': False}
            report['stages'].append(self.data)
            flush()
            self.context = browser.new_context(viewport=self.data['viewport'], device_scale_factor=1,
                                               reduced_motion='no-preference', service_workers='block')
            script = CLOCK.replace('__ORIGIN__', json.dumps(origin)).replace('__KEY__', json.dumps(key))
            script = script.replace('__EPOCH__', str(milestones[source]['save']['savedAt']))
            script = script.replace('__CONTROLLED__', 'true' if controlled else 'false')
            self.context.add_init_script(script)
            self.page = self.context.new_page()
            active = self
            self.page.set_default_timeout(10000)
            self.page.set_default_navigation_timeout(20000)
            self.page.on('pageerror', lambda error: report['errors'].append({'case': name, 'error': str(error)}))
            self.page.on('requestfailed', lambda request: report['failedRequests'].append({'case': name, 'url': request.url, 'failure': request.failure}))
            self.page.on('response', lambda response: self.responses.append((self.generation, response)) if response.request.resource_type == 'script' else None)
            self.cdp = self.context.new_cdp_session(self.page)
            self.cdp.send('Network.enable')
            self.cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
            self.cdp.on('Debugger.scriptParsed', lambda event: self.executed.append((self.generation, event)) if event.get('url', '').startswith(('http://', 'https://')) else None)
            self.cdp.send('Debugger.enable')
            response = self.page.goto(args.url, wait_until='networkidle')
            self.navigation(response, 'boot')
            self.assets()
            self.integrity()
            self.import_source(source)
            process_evidence()

        def op(self, operation, **detail):
            self.data['operations'].append({'operation': operation, 'hostSeconds': round(time.monotonic() - started, 3), **detail})
            flush()

        def navigation(self, response, operation):
            row = {'case': case, 'operation': operation, 'url': response.url if response else None,
                   'status': response.status if response else None, 'generation': self.generation}
            report['http'].append(row)
            check('actual pinned-origin HTTP 200 navigation', response is not None and response.status == 200 and response.url == args.url, row)

        def integrity(self):
            values = self.page.evaluate('window.__naturalRing.integrity()')
            required = ('localStorage', 'storageGet', 'storageSet', 'storageRemove', 'storageClear', 'fileText', 'confirm', 'setTimeout', 'setInterval')
            check('native Storage, unwrapped File.text, confirm and timers retained', all(values[name] for name in required), values)
            check('clock classification matches observed performance/RAF functions',
                  values['performanceNow'] == (not self.controlled) and values['raf'] == (not self.controlled))

        def assets(self):
            rows = []
            for generation, event in self.executed:
                identity = (generation, event['scriptId'])
                if identity in self.verified:
                    continue
                self.verified.add(identity)
                url = event['url']
                relative = unquote(urlparse(url).path).removeprefix(unquote(parsed.path))
                check('executed HTTP script belongs to pinned release', urlparse(url).netloc == parsed.netloc and urlparse(url).scheme == parsed.scheme and relative in release['files'] and relative.endswith('.js'), url)
                matches = [response for gen, response in self.responses if gen == generation and response.url == url and response.status == 200]
                check('executed script has an actual HTTP 200 response in this navigation', bool(matches), {'url': url, 'generation': generation})
                body = matches[-1].body()
                executed = self.cdp.send('Debugger.getScriptSource', {'scriptId': event['scriptId']})['scriptSource']
                row = {'case': case, 'generation': generation, 'url': url, 'releaseFile': relative,
                       'httpStatus': matches[-1].status, 'httpSha256': sha(body),
                       'executedSourceSha256': sha(executed), 'releaseSha256': release['files'][relative],
                       'responseBytes': len(body), 'scriptId': event['scriptId']}
                report['scriptAssets'].append(row)
                rows.append(row)
                check('complete HTTP bytes and actual V8-executed JS match release SHA256', sha(body) == sha(executed) == release['files'][relative], row)
            check('this navigation executed a verified release JS asset', any(row['case'] == case and row['generation'] == self.generation for row in report['scriptAssets']))
            flush()

        def click(self, selector, keyboard=False):
            locator = self.page.locator(selector)
            expect(locator).to_be_visible()
            expect(locator).to_be_enabled()
            if keyboard:
                locator.focus()
                self.page.keyboard.press('Enter')
            else:
                locator.click()
            self.op('trusted keyboard Enter' if keyboard else 'trusted browser click', selector=selector)

        def input_text(self, selector, value):
            self.click(selector)
            self.page.keyboard.press('ControlOrMeta+A')
            self.page.keyboard.type(str(value))
            self.page.keyboard.press('Tab')
            check('native keyboard entered the explicit value', self.page.locator(selector).input_value() == str(value), {'selector': selector, 'value': str(value)})

        def select_native(self, selector, value):
            locator = self.page.locator(selector)
            options = locator.locator('option').evaluate_all('(nodes)=>nodes.map(node=>node.value)')
            check('requested native select option exists within a bounded list', value in options and len(options) <= 100)
            locator.focus()
            self.page.keyboard.press('Home')
            for _ in range(options.index(value)):
                self.page.keyboard.press('ArrowDown')
            self.page.keyboard.press('Tab')
            check('native keyboard selected the actual requested option', locator.input_value() == value)
            self.op('trusted native select keyboard input', selector=selector, value=value)

        def tab(self, name):
            check('no unrequested offline catch-up modal', not self.page.locator('[data-bind="offline-modal"]').is_visible())
            self.click(f'[data-tab="{name}"]')
            if name == 'arcade':
                expect(self.page.locator('.ring-visual')).to_be_visible()

        def raw(self):
            return self.page.evaluate('(key)=>localStorage.getItem(key)', key)

        def saved(self):
            return json.loads(self.raw())['state']

        def save(self, label, return_ring=True):
            self.tab('save')
            self.click('[data-action="save"]')
            value = self.snapshot(label)
            if return_ring:
                self.tab('arcade')
            return value

        def snapshot(self, label):
            raw = self.raw()
            check('snapshot exists in native localStorage', isinstance(raw, str) and bool(raw))
            content = json.loads(raw)
            check('snapshot persists the actual release save revision', content['revision'] == release['saveRevision'] and content['version'] == release['saveVersion'])
            entry = {'label': label, **dump_bytes(f'{len(report["stages"]):02}-{len(self.data["snapshots"]):02}-{label}.json', raw),
                     'clock': self.page.evaluate('window.__naturalRing.clock()'),
                     'totalTime': content['state']['totalTime'], 'arcade': content['state']['arcade'],
                     'protocolSlots': content['state']['protocols']['slots']}
            self.data['snapshots'].append(entry)
            flush()
            return content['state']

        def import_source(self, source):
            incoming = milestones[source]['save']
            path = out / milestones[source]['evidence']['file']
            # Save the current real app world first so replacement/backup evidence
            # has actual native bytes, including the initial native new game.
            self.tab('save')
            self.click('[data-action="save"]')
            before = self.raw()
            current = json.loads(before)['state']
            active_planet = next(value for value in current['planets'] if value['id'] == current['activePlanetId'])
            count = self.page.evaluate('window.__naturalRing.files.length')
            imports_before = self.page.evaluate('window.__naturalRing.imports.length')
            dialogs = []
            wanted = [f'已读取存档 v{incoming["version"]}/r{incoming["revision"]}。',
                      f'第 {current["stats"]["launches"] + 1} 轮', f'{len(current["planets"])} 颗星球',
                      f'当前“{active_planet["name"]}”', '读取期间产生的变化也会被替换',
                      '保留当前已保存原件', '写入校验成功后才采用']

            def answer(dialog):
                valid = dialog.type == 'confirm' and all(part in dialog.message for part in wanted)
                row = {'purpose': 'explicit natural milestone import', 'type': dialog.type,
                       'message': dialog.message, 'accepted': valid, 'source': milestones[source]['name']}
                dialogs.append(row)
                self.data['dialogs'].append(row)
                # Never issue renderer reads while a modal is open.
                dialog.accept() if valid else dialog.dismiss()

            self.page.once('dialog', answer)
            self.page.locator('[data-bind="import-file"]').set_input_files(str(path))
            expect(self.page.locator('[data-bind="status"]')).to_contain_text('已导入并存入本地')
            self.page.wait_for_function('(n)=>window.__naturalRing.files.length===n+1 && window.__naturalRing.files[n].text!==null', arg=count)
            selected = self.page.evaluate('(n)=>window.__naturalRing.files[n]', count)
            check('one explicit native confirmation identifies source and replacement consequences', len(dialogs) == 1 and dialogs[0]['accepted'], dialogs)
            check('trusted real File selection and native text exactly match immutable source bytes',
                  selected['trusted'] and selected['name'] == path.name and selected['size'] == path.stat().st_size
                  and selected['error'] is None and selected['text'] == path.read_text(encoding='utf-8')
                  and selected['beforeRaw'] == before,
                  {'name': selected['name'], 'trusted': selected['trusted'], 'nativeFileTextSha256': sha(selected['text']),
                   'expectedSha256': milestones[source]['evidence']['sha256']})
            backups = self.page.evaluate('(key)=>Object.keys(localStorage).filter(k=>k===key+".backup"||k.startsWith(key+".backup.")).map(k=>({key:k,raw:localStorage.getItem(k)}))', key)
            check('replaced real saved bytes retained in a native backup', any(value['raw'] == before for value in backups))
            adopted = self.snapshot('import-' + source)
            observed_imports = self.page.evaluate('window.__naturalRing.imports')
            check('first native import terminal status has exact whole natural state',
                  len(observed_imports) == imports_before + 1 and json.loads(observed_imports[-1]['raw'])['state'] == incoming['state'])
            import_bytes = dump_bytes(f'{len(report["stages"]):02}-adopted-{source}.json', observed_imports[-1]['raw'])
            self.data.setdefault('adoptions', []).append({'sourceMilestone': milestones[source]['name'], **import_bytes})
            if self.controlled:
                check('complete controlled imported state equals unmodified natural milestone', adopted == incoming['state'])
            self.op('native File import and explicit confirmation', sourceMilestone=milestones[source]['name'],
                    gameSeconds=milestones[source]['gameSeconds'], sourceSave=milestones[source]['evidence'],
                    previousRawSha256=sha(before), backups=[{'key': value['key'], 'sha256': sha(value['raw'])} for value in backups])
            self.tab('arcade')

        def step(self, seconds=1):
            check('simulation steps are explicitly controlled and bounded', self.controlled and isinstance(seconds, int) and 1 <= seconds <= 3)
            for _ in range(seconds):
                self.page.evaluate('window.__naturalRingStep(1000)')
            self.op('controlled simulation time via native RAF dispatch', liveSeconds=seconds, maximumSingleGapMilliseconds=1000)

        def reload(self):
            before = self.raw()
            self.audit('before-reload')
            self.generation += 1
            self.cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
            response = self.page.reload(wait_until='networkidle')
            self.navigation(response, 'reload')
            self.assets()
            self.integrity()
            check('real reload preserves complete native saved state', self.saved() == json.loads(before)['state'])
            self.op('native HTTP reload', retainedRawSha256=sha(self.raw()))
            self.tab('arcade')

        def screenshot(self, name, selector=None):
            if selector:
                self.page.locator(selector).scroll_into_view_if_needed()
            animation_sample = '''() => ({title:document.querySelector('.ring-hero-title')?.textContent,lit:[...document.querySelectorAll('.arcade-tile.lit')].map(e=>Number(e.dataset.tile)),clock:window.__naturalRing.clock()})'''
            animation_before = self.page.evaluate(animation_sample) if name.endswith('-animation') else None
            path = out / (name + '.png')
            self.page.screenshot(path=str(path), full_page=False, animations='allow', timeout=5000)
            animation_after = self.page.evaluate(animation_sample) if animation_before else None
            if animation_before:
                check('animation remains genuinely active before and after screenshot capture',
                      all(sample['title'] == '正在揭晓' and bool(sample['lit']) for sample in (animation_before, animation_after)),
                      {'before': animation_before, 'after': animation_after})
            geometry = self.page.locator(selector).bounding_box() if selector else None
            if selector in ('.arcade-board', '[data-action="arcade-run"]'):
                viewport = self.page.viewport_size
                check('manual entry or animation board is fully visible in actual viewport', geometry and geometry['width'] > 0 and geometry['height'] > 0 and geometry['x'] >= -1 and geometry['y'] >= -1 and geometry['x'] + geometry['width'] <= viewport['width'] + 1 and geometry['y'] + geometry['height'] <= viewport['height'] + 1, geometry)
            row = {'case': case, 'file': path.name, 'sha256': sha(path.read_bytes()),
                   'bytes': path.stat().st_size, 'viewport': self.page.viewport_size,
                   'selectorScrolledIntoView': selector, 'targetGeometry': geometry, 'fullPage': False,
                   'animationBefore': animation_before, 'animationAfter': animation_after,
                   'clock': self.page.evaluate('window.__naturalRing.clock()')}
            report['screenshots'].append(row)
            flush()

        def audit(self, label):
            audit = self.page.evaluate('''() => ({events:window.__naturalRing.events,
                animation:window.__naturalRing.animation,advances:window.__naturalRing.advances,
                clock:window.__naturalRing.clock(),integrity:window.__naturalRing.integrity()})''')
            evidence = dump_bytes(f'{len(report["stages"]):02}-audit-{self.generation}-{label}.json', json.dumps(audit, ensure_ascii=False, indent=2))
            self.data.setdefault('audits', []).append(evidence)
            check('normal UI clicks, edits and keyboard events are trusted', all(value['trusted'] for value in audit['events']), {'events': len(audit['events'])})
            return audit

        def finish(self):
            self.snapshot('terminal')
            self.audit('terminal')
            self.integrity()
            self.assets()
            self.data['completed'] = True
            flush()
            self.context.close()
            process_evidence()

    def exact(actual, which, label):
        check(label, actual == state(which), {'expectedMilestone': milestones[which]['name']})

    def ring_unchanged(before, after, label):
        check(label, all(before['arcade'][field] == after['arcade'][field] for field in
                         ('runs', 'stats', 'autoBatch', 'seed', 'nextRunId', 'history', 'pity', 'rollPity', 'bets')))

    def audit_debit(stage, before, after, index, authorization):
        ticket_id = authorization['ticketIds'][index]
        witnesses = [row for row in source['autoDebits'] if row['ticketId'] == ticket_id]
        check('source has exactly one independently audited natural debit for ticket ' + str(ticket_id),
              len(witnesses) == 1 and witnesses[0]['exactWalletEquality'] is True)
        witness = witnesses[0]
        wallets = lambda current: {planet['id']: planet['resources'] for planet in current['planets']}
        check('all real before/after wallets exactly match the source debit witness',
              wallets(before) == witness['beforeWallets'] and wallets(after) == witness['afterWallets'],
              {'ticketId': ticket_id, 'actualBeforeWallets': wallets(before), 'actualAfterWallets': wallets(after),
               'expectedBeforeWallets': witness['beforeWallets'], 'expectedAfterWallets': witness['afterWallets']})
        first, last = before['arcade']['autoBatch'], after['arcade']['autoBatch']
        fixed = ('planetId', 'ticketIds', 'maxDeuterium', 'bets')
        check('each automatic pass retains original source, prefix, frozen bets and gross cap',
              all(first[field] == last[field] == authorization[field] for field in fixed))
        check('actual spend cursor and payer equal the independent natural debit audit',
              first['spentDeuterium'] == witness['spentBefore'] and last['spentDeuterium'] == witness['spentAfter']
              and last['planetId'] == witness['payerId'] and last['maxDeuterium'] == witness['budget']
              and after['activePlanetId'] == witness['selectedPlanetId']
              and Decimal(last['spentDeuterium']) - Decimal(first['spentDeuterium']) == Decimal(str(witness['quotedGrossDeuterium']))
              and Decimal(after['totalTime']) == witness['gameSeconds'])
        stage.op('actual native engine debit reconciled to independently hashed domain witness',
                 ticketId=ticket_id, sourceWitness=witness)

    def toggle(stage):
        stage.tab('protocol')
        stage.page.locator('[data-bind="slot-enabled-0"]').check()
        stage.op('trusted checkbox enable', selector='[data-bind="slot-enabled-0"]')
        stage.tab('arcade')

    @contextmanager
    def evidence_before_teardown():
        # Capture while the Playwright transport and failed page still exist.
        try:
            yield
        except BaseException as error:
            report.update(completed=False, result='failed', failure={'case': case, 'error': repr(error), 'traceback': traceback.format_exc()})
            flush()
            if active and active.page and not active.page.is_closed():
                for label, capture in (('save', lambda: active.snapshot('failure-state')),
                                       ('audit', lambda: active.audit('failure')),
                                       ('screenshot', lambda: active.screenshot('failure'))):
                    try:
                        capture()
                    except BaseException as diagnostic_error:
                        report['failure'].setdefault('diagnosticErrors', []).append({'step': label, 'error': repr(diagnostic_error)})
            flush()
            raise

    def timeout(_signal, _frame):
        raise TimeoutError('Natural-ring worker exceeded its bounded work interval')

    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(WORK_SECONDS)
    flush()
    try:
        check('acceptance requires a real HTTP(S) directory URL', parsed.scheme in ('http', 'https') and bool(parsed.netloc) and parsed.path.endswith('/') and not parsed.query and not parsed.fragment)
        check('release pin is an exact 40-character source SHA', bool(args.expected_sha and re.fullmatch(r'[0-9a-f]{40}', args.expected_sha)))
        original = Path(args.report).read_bytes()
        report['domainSource'] = dump_bytes('natural-domain-source-report.json', original)
        check('complete source report has an independent SHA256 pin', bool(args.expected_report_sha256 and re.fullmatch(r'[0-9a-f]{64}', args.expected_report_sha256)))
        check('source report matches independently pinned SHA256', sha(original) == args.expected_report_sha256)
        source = json.loads(original)
        check('source report schema and outcome are passed', source.get('schema') == 'infinity-natural-ring-journey-v1' and source.get('outcome', {}).get('status') == 'passed')
        check('source provenance excludes injected state and seed search', source.get('provenance', {}).get('injectedGameState') is False and source.get('provenance', {}).get('seedSearch') is False)
        metadata = source.get('source')
        check('source identity metadata is present', isinstance(metadata, dict))
        source_sha = source.get('sourceSha')
        check('report and actual generator checkout identify the exact release commit',
              source_sha == metadata.get('sourceSha') == metadata.get('gitHead') == args.expected_sha)
        generator = 'scripts/natural-ring-journey.ts'
        check('domain generator was tracked and clean when run', metadata.get('scriptPath') == generator
              and metadata.get('scriptDirty') is False and metadata.get('scriptStatusPorcelain') == '')

        def source_status(status):
            # Ordinary generated report/log/screenshot artifacts may be untracked.
            # Any tracked change, source-tree addition or runtime/config file is a
            # hard failure. Do not downgrade a dirty-source run into a limitation.
            issues, artifacts = [], []
            runtime_roots = {'src', 'public', 'scripts', '.github', '.agents', '.codex'}
            runtime_names = {'index.html', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json',
                             'tsconfig.json', '.npmrc', '.yarnrc', '.yarnrc.yml', 'vercel.json'}
            generated_suffixes = {'.json', '.jsonl', '.log', '.txt', '.png', '.jpg', '.webp', '.zip'}
            if not isinstance(status, str):
                return ['Missing porcelain status'], artifacts
            for line in status.splitlines():
                if not line.startswith('?? '):
                    issues.append({'status': line, 'reason': 'tracked change or unexpected status'})
                    continue
                path = line[3:]
                # Quoted/escaped paths are intentionally not interpreted as safe.
                if path.startswith('"') or path.startswith('/') or '..' in Path(path).parts:
                    issues.append({'status': line, 'reason': 'ambiguous generated-artifact path'})
                    continue
                parts = Path(path).parts
                name = Path(path).name
                runtime = (not parts or parts[0] in runtime_roots or name in runtime_names
                           or name.startswith(('.env', 'tsconfig.', 'vite.config.', 'vitest.config.')))
                if runtime or Path(path).suffix.lower() not in generated_suffixes:
                    issues.append({'status': line, 'reason': 'untracked runtime source/configuration or non-artifact'})
                else:
                    artifacts.append(path)
            return issues, artifacts

        reported_issues, reported_artifacts = source_status(metadata.get('worktreeStatusPorcelain'))
        check('reported worktree dirt consists only of generated artifacts', not reported_issues, reported_issues)
        check('reported dirty flag agrees with complete status', metadata.get('worktreeDirty') == bool(metadata['worktreeStatusPorcelain']))
        repository = Path(__file__).resolve().parent.parent

        def git(*arguments):
            return subprocess.check_output(['git', *arguments], cwd=repository, stderr=subprocess.PIPE, timeout=10)

        actual_head = git('rev-parse', 'HEAD').decode().strip()
        check('browser gate checkout matches the exact pinned source commit', actual_head == args.expected_sha)
        actual_status = git('status', '--porcelain=v1', '--untracked-files=all').decode().rstrip('\n')
        current_issues, current_artifacts = source_status(actual_status)
        check('current checkout has no tracked or untracked runtime-source edits', not current_issues, current_issues)
        tracked = git('ls-files', '--error-unmatch', '--', generator).decode().strip()
        check('actual domain generator path is tracked', tracked == generator)
        generator_bytes = (repository / generator).read_bytes()
        committed_bytes = git('show', args.expected_sha + ':' + generator)
        check('domain generator hash matches exact tracked committed bytes and report metadata',
              generator_bytes == committed_bytes and sha(generator_bytes) == metadata.get('scriptSha256'),
              {'actualSha256': sha(generator_bytes), 'reportSha256': metadata.get('scriptSha256')})
        report['domainSource'].update({'sourceSha': source_sha, 'sourceMetadata': metadata,
                                      'saveVersion': source['saveVersion'], 'saveRevision': source['saveRevision'],
                                      'outcome': source['outcome'], 'provenance': source['provenance'],
                                      'committedSourceTreeVerified': True, 'currentGitHead': actual_head,
                                      'generatorSha256': sha(generator_bytes),
                                      'reportedUntrackedArtifacts': reported_artifacts,
                                      'currentUntrackedArtifacts': current_artifacts})
        key = source['storageKey']
        check('source uses the original production storage key', key == 'infinity.original-p4.save.v1')
        names = [entry['name'] for entry in source['milestones']]
        check('required natural source milestones occur exactly once', all(names.count(name) == 1 for name in NAMES.values()))
        for alias, name in NAMES.items():
            milestone = next(value for value in source['milestones'] if value['name'] == name)
            incoming = milestone['save']
            check(name + ': immutable current-revision strict-reloaded natural save',
                  incoming['revision'] == source['saveRevision'] and incoming['version'] == source['saveVersion']
                  and milestone['stateAdoptedFromReload'] is True and milestone['strictRoundtrips'] >= 2
                  and incoming['savedAt'] == incoming['lastTickAt'])
            payload = json.dumps(incoming, ensure_ascii=False, indent=2) + '\n'
            evidence = dump_bytes('source-' + name + '.json', payload)
            milestones[alias] = {**milestone, 'evidence': evidence}
            report['sources'].append({'name': name, 'gameSeconds': milestone['gameSeconds'],
                                      **evidence, 'reportSha256': sha(original)})
        check('nine-manual source is genuinely locked with a real pending tenth ticket', state('nine')['arcade']['stats']['manualRuns'] == 9 and state('nine')['arcade']['stats']['autoRuns'] == 0 and 'auto_runner' not in state('nine')['unlockedCards'] and len(state('nine')['arcade']['runs']) == 1)
        check('first finite-batch source has natural tickets and no previous auto run', state('equipped')['arcade']['stats']['autoRuns'] == 0 and len(state('equipped')['arcade']['runs']) == 3 and state('equipped')['arcade']['autoBatch'] is None)
        flush()
        with sync_playwright() as playwright, evidence_before_teardown():
            options = {'headless': True, 'args': ['--no-sandbox', args.owner_marker]}
            executable = args.chromium or shutil.which('google-chrome') or shutil.which('chromium')
            if executable:
                options['executable_path'] = executable
            browser = playwright.chromium.launch(**options)
            process_evidence()
            request = playwright.request.new_context()
            response = request.get(urljoin(args.url, 'release.json'), timeout=15000)
            check('release metadata served by actual pinned-origin HTTP 200', response.status == 200 and response.url == urljoin(args.url, 'release.json'))
            release_bytes = response.body()
            release = json.loads(release_bytes)
            report['release'] = {**dump_bytes('release.json', release_bytes), 'url': response.url,
                                 'sourceSha': release.get('sourceSha'), 'saveRevision': release.get('saveRevision'),
                                 'saveVersion': release.get('saveVersion')}
            check('release.sourceSha exactly matches requested commit', release.get('sourceSha') == args.expected_sha)
            check('natural report is regenerated for the actual release revision', source['saveRevision'] == release.get('saveRevision') and source['saveVersion'] == release.get('saveVersion'))
            request.dispose()

            for width in WIDTHS:
                stage = Stage(f'native manual 9 to 10 at {width}px', 'nine', width, controlled=False)
                check('locked manual-count explanation is visible', '手动开奖 10 次' in stage.page.locator('#ring-auto-prerequisite').inner_text())
                check('locked card cannot authorize', stage.page.locator('[data-ring="auto-arm"]').is_disabled())
                stage.page.locator('[data-bind="arcade-skip"]').uncheck()
                check('skip animation is off', not stage.page.locator('[data-bind="arcade-skip"]').is_checked())
                check('manual entry precedes finite automation in DOM', bool(stage.page.locator('.arcade-controls').evaluate('(e)=>e.compareDocumentPosition(document.querySelector(".ring-auto")) & Node.DOCUMENT_POSITION_FOLLOWING')))
                stage.page.wait_for_function('''() => [...document.querySelectorAll('.ring-visual img.ring-art')].filter(e=>e.getClientRects().length).every(e=>e.complete && e.naturalWidth>0)''')
                check('ring page has no horizontal viewport overflow', stage.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
                stage.screenshot(f'manual-{width}-entry', '[data-action="arcade-run"]')
                before = stage.saved()
                start = time.monotonic()
                stage.click('[data-action="arcade-run"]', keyboard=width == 390)
                expect(stage.page.locator('.ring-hero-title')).to_have_text('正在揭晓')
                stage.screenshot(f'manual-{width}-animation', '.arcade-board')
                expect(stage.page.locator('.ring-hero-title')).not_to_have_text('正在揭晓', timeout=10000)
                duration = time.monotonic() - start
                observations = stage.page.evaluate('window.__naturalRing.animation')
                positions = {tuple(value['lit']) for value in observations if value['title'] == '正在揭晓' and value['lit']}
                check('native real-time animation visibly traverses multiple lit tiles', len(positions) >= 3 and duration >= 2.5,
                      {'distinctLitPositions': len(positions), 'hostElapsedSeconds': duration})
                after = stage.save('after-tenth-manual')
                check('one trusted manual reveal consumes only the naturally issued tenth ticket',
                      after['arcade']['stats']['manualRuns'] == 10 and after['arcade']['stats']['autoRuns'] == 0
                      and after['arcade']['stats']['runs'] == before['arcade']['stats']['runs'] + 1
                      and not after['arcade']['runs'] and after['arcade']['seed'] == before['arcade']['seed']
                      and after['arcade']['nextRunId'] == before['arcade']['nextRunId'])
                check('tenth result follows the source ticket outcome without rerolling',
                      after['arcade']['position'] == state('ten')['arcade']['position']
                      and all(after['arcade']['history'][-1].get(field) == state('ten')['arcade']['history'][-1].get(field) for field in ('symbol', 'big', 'auto'))
                      and after['arcade']['pity'] == state('ten')['arcade']['pity'])
                check('tenth manual result unlocks the actual auto-runner card', 'auto_runner' in after['unlockedCards'])
                stage.screenshot(f'manual-{width}-finished', '.arcade-board')
                audit = stage.audit('manual-input')
                check('manual activation was a trusted native button event', any(e['type'] == 'click' and e['action'] == 'arcade-run' and e['trusted'] for e in audit['events']))
                if width == 390:
                    check('390px manual action also has trusted Enter input', any(e['type'] == 'keydown' and e['key'] == 'Enter' and e['trusted'] for e in audit['events']))
                stage.finish()

            stage = Stage('native equipment defaults off', 'ten')
            stage.tab('protocol')
            stage.click('[data-action="equip-card"][data-card="auto_runner"]')
            equipped = stage.snapshot('actual-ui-equipped')
            check('real native equipment is disabled with no spending authority', equipped['protocols']['slots'][0]['card']['id'] == 'auto_runner' and equipped['protocols']['slots'][0]['card']['enabled'] is False and equipped['arcade']['autoBatch'] is None)
            expect(stage.page.locator('[data-bind="slot-enabled-0"]')).not_to_be_checked()
            stage.tab('arcade')
            check('fresh count and gross budget remain zero', stage.page.locator('#ring-auto-count').input_value() == '0' and stage.page.locator('#ring-auto-cap').input_value() == '0')
            stage.screenshot('equipment-default-off', '.ring-auto')
            stage.finish()

            stage = Stage('first bounded actual engine batch and native reload', 'equipped')
            initial = stage.saved()
            toggle(stage)
            stage.step()
            unarmed = stage.save('toggle-alone')
            exact(unarmed, 'toggle', 'plain enable and one real engine second match entire natural unarmed state')
            check('plain toggle consumes no ticket and grants no batch', unarmed['arcade']['runs'] == initial['arcade']['runs'] and unarmed['arcade']['stats'] == initial['arcade']['stats'] and unarmed['arcade']['autoBatch'] is None)
            expected_batch = state('armed')['arcade']['autoBatch']
            stage.input_text('#ring-auto-count', len(expected_batch['ticketIds']))
            stage.input_text('#ring-auto-cap', expected_batch['maxDeuterium'])
            stage.op('trusted explicit bounded inputs', count=len(expected_batch['ticketIds']), grossDeuteriumCap=expected_batch['maxDeuterium'])
            stage.click('[data-ring="auto-arm"]')
            stage.select_native('#planet-select', state('armed')['activePlanetId'])
            stage.op('trusted active-planet selection', planetId=state('armed')['activePlanetId'])
            armed = stage.snapshot('explicitly-armed')
            exact(armed, 'armed', 'trusted authorization and colony selection match complete natural armed state')
            check('arm captures only existing prefix, fixed source, frozen bets and finite gross budget',
                  armed['arcade']['autoBatch'] == expected_batch and expected_batch['ticketIds'] == [row['id'] for row in initial['arcade']['runs'][:2]] and expected_batch['spentDeuterium'] == '0')
            stage.step()
            partial = stage.save('one-remaining')
            exact(partial, 'partial', 'first actual browser engine pass matches complete natural one-remaining state')
            audit_debit(stage, armed, partial, 0, expected_batch)
            stage.screenshot('first-auto-one-remaining', '.ring-auto')
            stage.reload()
            check('reload retains exact old remainder without budget replenishment', stage.saved()['arcade']['autoBatch'] == partial['arcade']['autoBatch'])
            stage.step()
            finished = stage.save('bounded-batch-complete')
            batch = finished['arcade']['autoBatch']
            audit_debit(stage, partial, finished, 1, expected_batch)
            check('real automatic engine stops at two authorized tickets', batch['completed'] == 2 and not batch['armed'] and batch['ticketIds'] == expected_batch['ticketIds'] and Decimal(batch['spentDeuterium']) <= Decimal(batch['maxDeuterium']) and finished['arcade']['stats']['autoRuns'] == 2 and finished['arcade']['runs'] == initial['arcade']['runs'][2:])
            stage.reload()
            stage.step(2)
            ring_unchanged(finished, stage.save('completed-refresh-no-renewal'), 'completed batch cannot restart or widen after real reload')
            stage.screenshot('bounded-batch-terminal', '.ring-auto')
            stage.finish()

            stage = Stage('future natural ticket cannot extend completed authority', 'future')
            before = stage.saved()
            outside = [row['id'] for row in before['arcade']['runs'] if row['id'] not in before['arcade']['autoBatch']['ticketIds']]
            check('source contains real later tickets outside old prefix', bool(outside) and not before['arcade']['autoBatch']['armed'])
            toggle(stage)
            stage.step()
            after = stage.save('future-ticket-still-unspent')
            ring_unchanged(before, after, 'switch alone cannot authorize naturally generated later tickets')
            check('unarmed future-ticket engine pass cannot silently debit naturally saturated wallets', {p['id']: p['resources'] for p in before['planets']} == {p['id']: p['resources'] for p in after['planets']})
            stage.screenshot('future-ticket-no-authority', '.ring-auto')
            stage.finish()

            stage = Stage('explicit stop and native refresh do not renew authority', 'before_stop')
            before = stage.saved()
            stage.click('[data-ring="auto-stop"]', keyboard=True)
            stopped = stage.snapshot('explicit-stop')
            exact(stopped, 'stopped', 'trusted explicit stop matches complete natural stopped state')
            check('stop retains all unspent tickets and budget ledger', stopped['arcade']['runs'] == before['arcade']['runs'] and stopped['arcade']['autoBatch']['completed'] == 0 and stopped['arcade']['autoBatch']['spentDeuterium'] == '0' and not stopped['protocols']['slots'][0]['card']['enabled'])
            stage.reload()
            toggle(stage)
            stage.step(2)
            after = stage.save('stop-refresh-toggle-no-renewal')
            ring_unchanged(stopped, after, 'stop remains retired across refresh and plain toggle')
            check('stopped engine cannot silently debit naturally saturated wallets after refresh or switch', {p['id']: p['resources'] for p in stopped['planets']} == {p['id']: p['resources'] for p in after['planets']})
            stage.screenshot('explicit-stop-terminal', '.ring-auto')
            stage.finish()

            stage = Stage('real curvature UI retires one remaining authorization', 'before_curvature')
            before = stage.saved()
            check('curvature begins with a truly armed partially spent batch', before['arcade']['autoBatch']['armed'] and before['arcade']['autoBatch']['completed'] == 1 and len(before['arcade']['runs']) == 1 and before['protocols']['slots'][0]['card']['enabled'])
            stage.tab('curvature')
            expect(stage.page.locator('#prestige-preview')).to_have_attribute('data-eligible', 'true')
            check('read-only preview does not alter complete persisted natural state', stage.saved() == before)
            stage.screenshot('curvature-natural-preview', '#prestige-preview')
            dialogs = []

            def launch_confirm(dialog):
                valid = dialog.type == 'confirm' and all(text in dialog.message for text in ('确认发射殖民舰', '旧世界', '不退款', '仅保存验证成功才采用新世界'))
                row = {'purpose': 'explicit legal in-game curvature', 'type': dialog.type, 'message': dialog.message, 'accepted': valid}
                dialogs.append(row)
                stage.data['dialogs'].append(row)
                dialog.accept() if valid else dialog.dismiss()

            stage.page.once('dialog', launch_confirm)
            stage.click('[data-action="prestige"]')
            check('one native curvature confirmation was explicitly accepted', len(dialogs) == 1 and dialogs[0]['accepted'], dialogs)
            after = stage.snapshot('actual-curvature')
            exact(after, 'after_curvature', 'real UI curvature result matches complete natural domain candidate')
            check('curvature retires old batch and all ring cards while retaining unlock and tickets',
                  not after['arcade']['autoBatch']['armed'] and after['arcade']['autoBatch']['stopReason'] == '重置后需要重新授权自动批次'
                  and after['arcade']['runs'] == before['arcade']['runs'] and 'auto_runner' in after['unlockedCards']
                  and all(not slot['card']['enabled'] for slot in after['protocols']['slots'] if slot['card'] and slot['card']['action']['kind'] == 'runLights'))
            stage.tab('arcade')
            stage.screenshot('curvature-retired-authority', '.ring-auto')
            stage.reload()
            toggle(stage)
            stage.step()
            ring_unchanged(after, stage.save('curvature-refresh-no-renewal'), 'old curvature authority cannot revive after native refresh and switch')
            stage.finish()

            stage = Stage('post-curvature natural beacon has no inherited authority', 'post_curvature')
            before = stage.saved()
            old_ids = before['arcade']['autoBatch']['ticketIds']
            check('post-curvature milestone has a real natural beacon outside old authority', any(row['source'] == 'beacon' and row['id'] not in old_ids for row in before['arcade']['runs']) and before['stats']['launches'] == 1)
            stage.reload()
            toggle(stage)
            stage.step()
            ring_unchanged(before, stage.save('new-beacon-old-authority-stays-retired'), 'new natural post-curvature beacon cannot renew old batch on refresh or switch')
            stage.screenshot('post-curvature-new-beacon', '.ring-auto')
            stage.finish()
            check('no uncaught application JS errors', not report['errors'], report['errors'])
            check('no failed native resource requests', not report['failedRequests'], report['failedRequests'])
            check('every required stage completed', len(report['stages']) == len(WIDTHS) + 6 and all(item['completed'] for item in report['stages']))
            report.update(completed=True, result='passed')
            flush()
            browser.close()
            browser = None
    except BaseException as error:
        if 'failure' not in report:
            report['failure'] = {'case': case, 'error': repr(error), 'traceback': traceback.format_exc()}
        report.update(completed=False, result='failed')
        flush()
    finally:
        signal.alarm(0)
        if browser:
            try:
                process_evidence()
                browser.close()
            except BaseException as cleanup_error:
                report.setdefault('cleanupErrors', []).append(repr(cleanup_error))
                report.update(completed=False, result='failed')
        flush()
    return 0 if report['completed'] and report['result'] == 'passed' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
    parser.add_argument('--report', default='natural-ring-report.json', help='Passed current-release natural domain report, never a hand-edited save')
    parser.add_argument('--output', default='natural-ring-browser-evidence', help='Must be empty before the supervised run')
    parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA'), help='Exact release.sourceSha; required unless GITHUB_SHA is set')
    parser.add_argument('--expected-report-sha256', required=True, help='Independently captured SHA256 of the complete passed current-commit domain report')
    parser.add_argument('--chromium')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--owner-marker', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker and not args.owner_marker:
        parser.error('The worker is internal; run through the independent supervisor.')
    return worker(args) if args.worker else supervise(args)


if __name__ == '__main__':
    raise SystemExit(main())
