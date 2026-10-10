"""Reproduce the known protected-session ring-control mismatch, without a UI fix.

Only natural journey saves and trusted browser input create game state. Explicit
current-slot write/readback fault injection and a real same-origin second tab
exercise SaveSession. Native Storage delegates unchanged outside labeled faults.
Clocks/RAF/autosave are controlled, as in browser-render-scheduling.py. A CDP
conditional breakpoint reads the actual module state through its existing pure
serializer; it does not modify game state, handlers, or the served bundle.

A zero exit means baselineKnownLimitationReproduced, never UI correctness. The
production tree must remain byte-identical to the pinned baseline. This script
intentionally has no future-fixed assertion mode until a fix is independently
specified. Linux bounded process cleanup is reused from browser-natural-ring.py.
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
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

REPORT_NAME = 'ring-protection-report.json'
WORK_SECONDS, SUPERVISOR_SECONDS = 210, 225
BASELINE = '7f17a121ff35822a85d6889a9823f76bccbff227'
NAMES = {'equipped': '08-equipped-off-current-three-tickets',
         'armed': '10-armed-two-existing-tickets-fixed-home-source',
         'before_stop': '13-armed-before-explicit-stop'}
CONTROLS = {
    'manual-run': '[data-action="arcade-run"]',
    'manual-all': '[data-action="arcade-all"]',
    'bet-plus': '[data-action="arcade-bet"][data-symbol="metal"][data-delta="1"]',
    'bet-minus': '[data-action="arcade-bet"][data-symbol="metal"][data-delta="-1"]',
    'clear': '[data-action="arcade-bet-clear"]',
    'topup': '[data-action="arcade-topup"]',
    'auto-arm': '[data-ring="auto-arm"]',
    'auto-stop': '[data-ring="auto-stop"]',
    'slot': '#ring-auto-slot', 'count': '#ring-auto-count', 'cap': '#ring-auto-cap',
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
    marker = '--ring-protection-owner=' + uuid.uuid4().hex
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
    passed = result.get('completed') and result.get('result') == 'baselineKnownLimitationReproduced'
    print(json.dumps({'completed': bool(passed), 'result': result.get('result'),
                      'checks': len(result.get('checks', [])), 'report': str(report_path)}, ensure_ascii=False))
    return 0 if passed else 1


INIT = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const key=__KEY__,epoch=__EPOCH__,get=Storage.prototype.getItem,set=Storage.prototype.setItem;
 const native=fn=>/\[native code\]/.test(Function.prototype.toString.call(fn));
 const integrity={storage:localStorage instanceof Storage,get:native(get),set:native(set),
  fileText:native(File.prototype.text),confirm:native(window.confirm)};
 let elapsed=0,next=0;const callbacks=new Map(),intervals=new Map();
 Date.now=()=>epoch+elapsed;Object.defineProperty(performance,'now',{value:()=>elapsed});
 window.requestAnimationFrame=fn=>{const id=++next;callbacks.set(id,fn);return id;};
 window.cancelAnimationFrame=id=>callbacks.delete(id);
 window.setInterval=(fn,ms,...args)=>{const id=++next;intervals.set(id,{fn,ms,args});return id;};
 window.clearInterval=id=>intervals.delete(id);
 const p={events:[],files:[],observed:[],fault:null,faultWritten:false,readFaults:0,integrity,
  raw:()=>get.call(localStorage,key),
  storage:()=>Object.keys(localStorage).filter(k=>k===key||k.startsWith(key+'.backup')).sort().map(k=>({key:k,raw:get.call(localStorage,k)})),
  clock:()=>({epoch,elapsed,dateNow:Date.now(),performanceNow:performance.now()}),
  advance:ms=>{if(!Number.isInteger(ms)||ms<0||ms>3000)throw Error('Bounded controlled clock only');elapsed+=ms;},
  frame:()=>{const due=[...callbacks.values()];callbacks.clear();for(const fn of due)fn(elapsed);return due.length;},
  autosave:()=>{const due=[...intervals.values()].filter(x=>x.ms===15000);for(const x of due)x.fn(...x.args);return due.length;},
  inject:kind=>{p.fault=kind;p.faultWritten=false;p.readFaults=0;}
 };
 window.__ringProtection=p;
 const watched=k=>k===key||k.startsWith(key+'.backup');
 Storage.prototype.getItem=function(k){
  k=String(k);
  if(this===localStorage&&k===key&&p.fault==='readback-throw'&&p.faultWritten&&p.readFaults===0){
   p.readFaults++;p.events.push({operation:'read-throw',key:k,injected:true,at:elapsed});
   throw new DOMException('Labeled post-write readback refusal','SecurityError');
  }
  const value=get.call(this,k);
  if(this===localStorage&&watched(k))p.events.push({operation:'read',key:k,value,at:elapsed});
  return value;
 };
 Storage.prototype.setItem=function(k,v){
  k=String(k);v=String(v);
  if(this!==localStorage||!watched(k))return set.call(this,k,v);
  p.events.push({operation:'write-attempt',key:k,value:v,before:get.call(this,k),at:elapsed});
  if(k===key&&p.fault==='write-throw'){
   p.events.push({operation:'write-throw',key:k,injected:true,at:elapsed});
   throw new DOMException('Labeled targeted current-slot write failure','QuotaExceededError');
  }
  set.call(this,k,v);
  if(k===key)p.faultWritten=true;
  p.events.push({operation:'write-return',key:k,value:v,actual:get.call(this,k),at:elapsed});
 };
 window.addEventListener('storage',event=>{
  if(event.storageArea===localStorage&&event.key===key)p.events.push({operation:'storage-event',
   key:event.key,trusted:event.isTrusted,oldValue:event.oldValue,newValue:event.newValue,url:event.url,at:elapsed});
 });
 for(const type of ['click','input','change','keydown'])document.addEventListener(type,event=>{
  const target=event.target.closest?.('button,input,select');
  if(target)p.events.push({operation:'ui-'+type,trusted:event.isTrusted,id:target.id,
   action:target.dataset.action??null,ring:target.dataset.ring??null,bind:target.dataset.bind??null,at:elapsed});
  if(type==='change'&&target?.matches('[data-bind="import-file"]')){
   const file=target.files[0],row={name:file?.name,size:file?.size,trusted:event.isTrusted,
    beforeRaw:get.call(localStorage,key),text:null,error:null};p.files.push(row);
   if(file)file.text().then(text=>row.text=text,error=>row.error=String(error));
  }
 },true);
})();'''


def worker(args):
    from playwright.sync_api import sync_playwright, expect
    out = Path(args.output).resolve()
    started = time.monotonic()
    parsed = urlparse(args.url)
    origin = f'{parsed.scheme}://{parsed.netloc}'
    repository = Path(__file__).resolve().parent.parent
    report = {'schema': 'infinity-ring-protection-browser-v1', 'completed': False,
              'result': 'running', 'expectation': args.expect, 'expectedSourceSha': args.expected_sha,
              'productionBaselineSha': BASELINE, 'url': args.url,
              'classification': 'known limitation reproduction; not a UI safety/correctness pass',
              'clockMode': 'controlled Date/performance/RAF/autosave callbacks, actual HTTP and native Storage',
              'liveStateObservation': 'Read-only CDP conditional breakpoint at original application frame; calls unchanged pure serializeState, records actual SaveSession mode and original bytes; never assigns any production state.',
              'checks': [], 'stages': [], 'sources': [], 'scriptAssets': [], 'errors': [], 'failedRequests': [],
              'runtime': {'python': platform.python_version(), 'platform': platform.platform()},
              'limitations': ['Write/readback failures are explicitly injected, not natural quota exhaustion.',
                             'Desktop Chromium only; no background-throttling or physical mobile claim.',
                             'Enabled protected controls are a reproduced UI defect; rejected actions and frozen state do not fix that defect.',
                             'Top-up is an explicitly ready-disabled insufficient-funds control in these natural saves; this run does not reproduce a top-up misleading-enabled defect.']}
    case, active, browser, release, source, key = 'provenance', None, None, None, None, None
    milestones = {}

    def flush():
        report.update(activeCase=case, elapsedHostSeconds=round(time.monotonic()-started, 3))
        atomic_json(out / REPORT_NAME, report)

    def check(name, condition, detail=None):
        row = {'case': case, 'name': name, 'passed': bool(condition)}
        if detail is not None:
            row['detail'] = detail
        report['checks'].append(row)
        flush()
        if not condition:
            raise AssertionError(f'{case}: {name}')

    def dump(name, value):
        data = value.encode() if isinstance(value, str) else value
        (out / name).write_bytes(data)
        return {'file': name, 'bytes': len(data), 'sha256': sha(data)}

    def dump_json(name, value):
        return dump(name, json.dumps(value, ensure_ascii=False, indent=2)+'\n')

    def git(*arguments):
        return subprocess.check_output(['git', *arguments], cwd=repository, stderr=subprocess.PIPE, timeout=10)

    def clean_status(value):
        if not isinstance(value, str):
            return False
        for line in value.splitlines():
            if not line.startswith('?? '):
                return False
            path = Path(line[3:])
            if (line[3:].startswith(('"', '/')) or '..' in path.parts or not path.parts
                or path.parts[0] in {'src', 'public', 'scripts', '.github', '.agents', '.codex'}
                or path.suffix.lower() not in {'.json', '.jsonl', '.log', '.txt', '.png', '.jpg', '.webp', '.zip'}
                or path.name in {'package.json', 'package-lock.json', 'tsconfig.json', 'vercel.json'}
                or path.name.startswith(('.env', 'tsconfig.', 'vite.config.', 'vitest.config.'))):
                return False
        return True

    def processes():
        client = browser.new_browser_cdp_session()
        try:
            identities = [process_identity(int(row['id'])) for row in client.send('SystemInfo.getProcessInfo')['processInfo']]
            path = out / 'chromium-processes.json'
            prior = json.loads(path.read_text()) if path.exists() else []
            rows = {(row['pid'], row['startTimeTicks']): row for row in prior + [x for x in identities if x]}
            atomic_json(path, list(rows.values()))
        finally:
            client.detach()

    class Page:
        def __init__(self, context, stage, label):
            self.stage, self.label = stage, label
            self.page = context.new_page()
            self.page.set_default_timeout(7000)
            self.page.set_default_navigation_timeout(15000)
            self.responses, self.executed = [], []
            self.page.on('response', lambda r: self.responses.append(r) if r.request.resource_type == 'script' else None)
            self.page.on('pageerror', lambda e: report['errors'].append({'case': case, 'page': label, 'error': str(e)}))
            self.page.on('requestfailed', lambda r: report['failedRequests'].append({'case': case, 'page': label, 'url': r.url, 'failure': r.failure}))
            self.cdp = context.new_cdp_session(self.page)
            self.cdp.send('Network.enable')
            self.cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
            self.cdp.on('Debugger.scriptParsed', lambda e: self.executed.append(e) if e.get('url', '').startswith(('http://', 'https://')) else None)
            self.cdp.send('Debugger.enable')
            response = self.page.goto(args.url, wait_until='networkidle')
            check('actual HTTP 200 production navigation', response is not None and response.status == 200 and response.url == args.url)
            self.page.locator('[data-bind="amount-metal"]').wait_for()
            check('captured Storage backing and unchanged native File.text/confirm are real', all(self.page.evaluate('window.__ringProtection.integrity').values()))
            self.verify_assets_and_observer()
            self.frame()

        def verify_assets_and_observer(self):
            installed = 0
            for event in self.executed:
                url = event['url']
                relative = unquote(urlparse(url).path).removeprefix(unquote(parsed.path))
                check('executed HTTP script belongs to pinned release', urlparse(url).scheme == parsed.scheme and urlparse(url).netloc == parsed.netloc and relative in release['files'] and relative.endswith('.js'), url)
                matches = [r for r in self.responses if r.url == url and r.status == 200]
                check('V8-executed source has its real HTTP 200 response', bool(matches), url)
                body = matches[-1].body()
                text = self.cdp.send('Debugger.getScriptSource', {'scriptId': event['scriptId']})['scriptSource']
                row = {'case': case, 'page': self.label, 'url': url, 'releaseFile': relative,
                       'httpSha256': sha(body), 'executedSourceSha256': sha(text),
                       'releaseSha256': release['files'][relative], 'bytes': len(body)}
                report['scriptAssets'].append(row)
                check('complete HTTP bytes and actual executed JS match pinned release hash', sha(body) == sha(text) == release['files'][relative], row)
                anchors = list(re.finditer(r'async function ([\w$]+)\(([\w$]+)\)\{([\w$]+)\.cancelPendingImport\(\);const [\w$]+=\["save","export"', text))
                if not anchors:
                    continue
                check('exactly one original guarded action handler exists', len(anchors) == 1)
                anchor = anchors[0]
                session = anchor.group(3)
                body_after = text[anchor.end():anchor.end()+700]
                state_match = re.search(r'const [\w$]+=([\w$]+),[\w$]+=\1\.unlocked;', body_after)
                serializers = list(re.finditer(r'function ([\w$]+)\([\w$]+\)\{return\{buildingTemplates:', text))
                frames = list(re.finditer(r'window\.requestAnimationFrame\(([\w$]+)\);window\.setInterval', text))
                check('state, pure production serializer and original frame resolve uniquely', state_match is not None and len(serializers) == len(frames) == 1)
                state, serializer, frame = state_match.group(1), serializers[0].group(1), frames[0].group(1)
                declaration = re.search(r'function '+re.escape(frame)+r'\([\w$]+\)\{', text)
                check('original application RAF declaration exists', declaration is not None)
                position = declaration.end()
                line = text.count('\n', 0, position)
                column = position-(text.rfind('\n', 0, position)+1)
                expression = f'globalThis.__ringProtection.observed.push(JSON.stringify({{state:{serializer}({state}),mode:{session}.mode,notice:{session}.notice,message:{session}.message,expectedRaw:{session}.expectedRaw,protectedRaw:{session}.protectedRaw}})),false'
                location = self.cdp.send('Debugger.setBreakpointByUrl', {'url': url, 'lineNumber': line, 'columnNumber': column, 'condition': expression})
                check('read-only live-state observer bound to actual original frame', len(location.get('locations', [])) == 1, location)
                self.stage.setdefault('observerBindings', []).append({'page': self.label, 'url': url, 'location': location, 'expression': expression})
                installed += 1
            check('one complete verified application asset supplies observation', installed == 1)

        def frame(self, milliseconds=0):
            before = self.page.evaluate('window.__ringProtection.observed.length')
            if milliseconds:
                self.page.evaluate('n=>window.__ringProtection.advance(n)', milliseconds)
            count = self.page.evaluate('window.__ringProtection.frame()')
            observed = self.page.evaluate('window.__ringProtection.observed.slice(-1)[0]')
            check('controlled wave runs the original frame with a fresh complete-state observation', count >= 1 and self.page.evaluate('window.__ringProtection.observed.length') == before+1 and observed is not None)
            return json.loads(observed)

        def click(self, selector):
            locator = self.page.locator(selector)
            check('native pointer target is visible and enabled: '+selector, locator.is_visible() and locator.is_enabled())
            hit = locator.evaluate('''e=>{e.scrollIntoView({block:'center',inline:'center',behavior:'instant'});const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return h===e||e.contains(h);}''')
            check('native pointer target is unobscured: '+selector, hit)
            locator.click(force=True)
            self.frame()

        def tab(self, name):
            check('no unintended offline catch-up modal', not self.page.locator('[data-bind="offline-modal"]').is_visible())
            self.click(f'[data-tab="{name}"]')
            check('requested original tab is visible', self.page.locator(f'[data-tab-panel="{name}"]').is_visible())

        def type(self, selector, value):
            self.click(selector)
            self.page.keyboard.press('ControlOrMeta+A')
            self.page.keyboard.type(str(value))
            self.page.keyboard.press('Tab')
            self.frame()
            check('trusted keyboard enters actual draft value', self.page.locator(selector).input_value() == str(value))

        def raw(self):
            return self.page.evaluate('window.__ringProtection.raw()')

        def storage(self):
            return self.page.evaluate('window.__ringProtection.storage()')

        def import_source(self, alias):
            self.tab('save')
            self.click('[data-action="save"]')
            before = self.raw()
            current = json.loads(before)['state']
            planet = next(p for p in current['planets'] if p['id'] == current['activePlanetId'])
            incoming = milestones[alias]['save']
            required = [f'已读取存档 v{incoming["version"]}/r{incoming["revision"]}。', f'第 {current["stats"]["launches"]+1} 轮',
                        f'{len(current["planets"])} 颗星球', f'当前“{planet["name"]}”',
                        '读取期间产生的变化也会被替换', '保留当前已保存原件', '写入校验成功后才采用']
            dialogs = []
            def answer(dialog):
                valid = dialog.type == 'confirm' and all(x in dialog.message for x in required)
                dialogs.append({'page': self.label, 'type': dialog.type, 'message': dialog.message, 'accepted': valid})
                dialog.accept() if valid else dialog.dismiss()
            self.page.once('dialog', answer)
            index = self.page.evaluate('window.__ringProtection.files.length')
            path = out / milestones[alias]['evidence']['file']
            self.page.locator('[data-bind="import-file"]').set_input_files(str(path))
            expect(self.page.locator('[data-bind="status"]')).to_contain_text('已导入并存入本地')
            self.page.wait_for_function('(i)=>!!window.__ringProtection.files[i] && window.__ringProtection.files[i].text!==null', arg=index)
            row = self.page.evaluate('(i)=>window.__ringProtection.files[i]', index)
            check('one native confirmation identifies source and exact replacement consequences', len(dialogs) == 1 and dialogs[0]['accepted'], dialogs)
            check('real selected File native text exactly equals immutable natural source', row['trusted'] and row['text'] == path.read_text() and row['size'] == path.stat().st_size and row['beforeRaw'] == before and row['error'] is None)
            check('native import backs up the complete previous current bytes', any(x['raw'] == before and x['key'] != key for x in self.storage()))
            observed = self.frame()
            check('import adopts the complete exact natural state only after persistence', observed['mode'] == 'ready' and observed['state'] == incoming['state'] == json.loads(self.raw())['state'])
            self.stage.setdefault('imports', []).append({'page': self.label, 'source': alias, 'dialogs': dialogs,
                'selectedFile': dump_json(f'{case}-{self.label}-selected-file.json', row),
                'before': dump(f'{case}-{self.label}-before-import.json', before),
                'adopted': dump(f'{case}-{self.label}-adopted.json', self.raw())})
            self.tab('arcade')

        def snapshot(self, label):
            observed = self.frame()
            controls = {name: self.page.locator(selector).evaluate('''e=>({disabled:e.disabled,visible:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length),value:e.value??null,text:e.textContent,title:e.title,html:e.outerHTML})''') for name, selector in CONTROLS.items()}
            observed.update(controls=controls, storage=self.storage(), clock=self.page.evaluate('window.__ringProtection.clock()'),
                            status=self.page.locator('[data-bind="status"]').inner_text(),
                            visibleNotice=self.page.locator('[data-bind="notice"]').is_visible(),
                            noticeText=self.page.locator('[data-bind="notice-text"]').inner_text())
            evidence = dump_json(f'{case}-{self.label}-{label}.json', observed)
            dom = dump_json(f'{case}-{self.label}-{label}-dom.json', {'html': self.page.content()})
            self.stage.setdefault('snapshots', []).append({'page': self.label, 'label': label, 'fullStateAndStorage': evidence, 'dom': dom})
            return observed

        def audit(self):
            events = self.page.evaluate('window.__ringProtection.events')
            check('all observed ordinary browser input events are trusted', all(e['trusted'] for e in events if e['operation'].startswith('ui-')))
            return events

        def export_original(self, expected, suffix):
            self.tab('save')
            with self.page.expect_download() as pending:
                self.click('[data-action="export"]')
            download = pending.value
            check('original download succeeds', download.failure() is None)
            path = out / f'{case}-{suffix}-protected-original.json'
            download.save_as(path)
            check('export retains complete original bytes exactly', path.read_text() == expected)
            self.stage.setdefault('exports', []).append({'file': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())})
            self.tab('arcade')

    @contextmanager
    def evidence_before_teardown():
        # Diagnostics must be collected before Playwright closes its transport.
        try:
            yield
        except BaseException as error:
            report.update(completed=False, result='failed', failure={'case': case, 'error': repr(error), 'traceback': traceback.format_exc()})
            flush()
            if active and not active.page.is_closed():
                for name, capture in [('snapshot', lambda: active.snapshot('failure')),
                                      ('audit', lambda: dump_json(case+'-failure-audit.json', active.audit())),
                                      ('screenshot', lambda: active.page.screenshot(path=str(out / 'failure.png'), full_page=True, timeout=5000))]:
                    try:
                        capture()
                    except BaseException as diagnostic:
                        report['failure'].setdefault('diagnosticErrors', []).append({'step': name, 'error': repr(diagnostic)})
            flush()
            raise

    def timeout(_signal, _frame):
        raise TimeoutError('Ring protection worker exceeded bounded work interval')

    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(WORK_SECONDS)
    flush()
    try:
        check('native acceptance uses an HTTP(S) directory URL', parsed.scheme in ('http', 'https') and bool(parsed.netloc) and parsed.path.endswith('/') and not parsed.query and not parsed.fragment)
        check('exact source SHA and independent domain report digest supplied', bool(re.fullmatch(r'[0-9a-f]{40}', args.expected_sha or '')) and bool(re.fullmatch(r'[0-9a-f]{64}', args.expected_report_sha256)))
        original = Path(args.report).read_bytes()
        check('complete domain report matches independently captured SHA256', sha(original) == args.expected_report_sha256)
        report['domainSource'] = dump('natural-domain-source-report.json', original)
        source = json.loads(original)
        metadata = source.get('source', {})
        check('passed natural report excludes injected game state and seed search', source.get('schema') == 'infinity-natural-ring-journey-v1' and source.get('outcome', {}).get('status') == 'passed' and source.get('provenance', {}).get('injectedGameState') is False and source.get('provenance', {}).get('seedSearch') is False)
        check('domain report and generator identify exact current release source', source.get('sourceSha') == metadata.get('sourceSha') == metadata.get('gitHead') == args.expected_sha == git('rev-parse', 'HEAD').decode().strip())
        check('natural generator source is tracked and clean', metadata.get('scriptPath') == 'scripts/natural-ring-journey.ts' and metadata.get('scriptDirty') is False and metadata.get('scriptStatusPorcelain') == '')
        generator = repository / metadata['scriptPath']
        check('natural generator hash matches report and exact committed bytes', generator.read_bytes() == git('show', args.expected_sha+':'+metadata['scriptPath']) and sha(generator.read_bytes()) == metadata.get('scriptSha256'))
        check('domain report dirty status only contains generated artifacts', clean_status(metadata.get('worktreeStatusPorcelain')) and metadata.get('worktreeDirty') == bool(metadata.get('worktreeStatusPorcelain')))
        check('acceptance checkout has no runtime/source edits', clean_status(git('status', '--porcelain=v1', '--untracked-files=all').decode().rstrip('\n')))
        production = ['src', 'public', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts']
        check('baseline reproduction leaves committed production tree byte-identical', git('diff', '--name-only', BASELINE, args.expected_sha, '--', *production) == b'')
        report['domainSource']['sourceMetadata'] = metadata
        key = source['storageKey']
        check('actual original native storage key is unchanged', key == 'infinity.original-p4.save.v1')
        for alias, name in NAMES.items():
            matches = [m for m in source['milestones'] if m['name'] == name]
            check('natural milestone occurs exactly once: '+name, len(matches) == 1)
            value = matches[0]
            incoming = value['save']
            check('natural save has strict reload provenance and source epoch: '+alias, value['stateAdoptedFromReload'] is True and value['strictRoundtrips'] >= 2 and incoming['savedAt'] == incoming['lastTickAt'] and incoming['revision'] == source['saveRevision'] and incoming['version'] == source['saveVersion'])
            evidence = dump_json('source-'+name+'.json', incoming)
            milestones[alias] = {**value, 'evidence': evidence}
            report['sources'].append({'name': name, **evidence})
        with sync_playwright() as playwright, evidence_before_teardown():
            options = {'headless': True, 'args': ['--no-sandbox', args.owner_marker]}
            executable = args.chromium or shutil.which('google-chrome') or shutil.which('google-chrome-stable') or shutil.which('chromium')
            if executable:
                options['executable_path'] = executable
            browser = playwright.chromium.launch(**options)
            actual_executable = executable or playwright.chromium.executable_path
            report['runtime'].update(executablePath=actual_executable, browserVersion=browser.version,
                executableVersion=subprocess.check_output([actual_executable, '--version'], stderr=subprocess.STDOUT, timeout=10).decode().strip())
            processes()
            request = playwright.request.new_context()
            response = request.get(urljoin(args.url, 'release.json'), timeout=15000)
            check('release metadata is native HTTP 200 from exact origin', response.status == 200 and response.url == urljoin(args.url, 'release.json'))
            release = response.json()
            report['release'] = dump('release.json', response.body())
            check('release pin and save revision match natural source exactly', release.get('sourceSha') == args.expected_sha and release.get('saveRevision') == source['saveRevision'] and release.get('saveVersion') == source['saveVersion'])
            request.dispose()
            for fault in ('write-throw', 'readback-throw', 'second-tab'):
                for alias in ('equipped', 'armed'):
                    case = fault+'-'+alias
                    stage = {'name': case, 'fault': fault, 'source': alias, 'completed': False, 'result': 'running'}
                    report['stages'].append(stage)
                    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True, service_workers='block')
                    context.add_init_script(INIT.replace('__ORIGIN__', json.dumps(origin)).replace('__KEY__', json.dumps(key)).replace('__EPOCH__', str(milestones[alias]['save']['savedAt'])))
                    primary = Page(context, stage, 'primary')
                    active = primary
                    primary.import_source(alias)
                    if alias == 'equipped':
                        primary.type('#ring-auto-count', 1)
                        primary.type('#ring-auto-cap', milestones['armed']['save']['state']['arcade']['autoBatch']['maxDeuterium'])
                    else:
                        # A normal native select returns to the real funded home
                        # without altering the batch's existing fixed source.
                        primary.page.locator('#planet-select').focus()
                        primary.page.keyboard.press('Home')
                        primary.page.keyboard.press('Tab')
                        primary.frame()
                        check('armed source selection uses the actual funded home', primary.frame()['state']['activePlanetId'] == 'homeworld')
                    ready = primary.snapshot('ready')
                    required = ['manual-run', 'manual-all', 'bet-plus', 'bet-minus', 'clear', 'slot', 'count', 'cap', 'auto-arm' if alias == 'equipped' else 'auto-stop']
                    check('every targeted control is genuinely enabled and visible while ready', ready['mode'] == 'ready' and all(ready['controls'][name]['visible'] and not ready['controls'][name]['disabled'] for name in required), ready['controls'])
                    # Independent production-domain preflight for these exact
                    # natural milestones: topUpPrice=234670, home deuterium=140000.
                    # This is a declared negative control, never a positive target.
                    stage['readyDisabledControl'] = {'control': 'topup', 'costFromProductionDomainPreflight': 234670,
                        'availableHomeDeuterium': next(p for p in ready['state']['planets'] if p['id'] == 'homeworld')['resources']['deuterium'],
                        'observedTitle': ready['controls']['topup']['title'], 'misleadingEnabledCoverage': False}
                    check('natural top-up is explicitly disabled before protection for insufficient funds',
                          ready['state']['activePlanetId'] == 'homeworld'
                          and next(p for p in ready['state']['planets'] if p['id'] == 'homeworld')['resources']['deuterium'] == '140000'
                          and ready['controls']['topup']['visible'] and ready['controls']['topup']['disabled']
                          and ready['controls']['topup']['title'] == '重氢不足（需要 2.35e5）', stage['readyDisabledControl'])
                    original_raw = primary.raw()
                    original_storage = primary.storage()
                    primary.page.evaluate('window.__ringProtection.events.length=0')
                    if fault != 'second-tab':
                        primary.tab('save')
                        primary.page.evaluate('kind=>window.__ringProtection.inject(kind)', fault)
                        # One millisecond changes the envelope but no simulation
                        # frame runs until the protected save has returned.
                        primary.page.evaluate('window.__ringProtection.advance(1)')
                        primary.click('[data-action="save"]')
                        events = primary.audit()
                        attempts = [e for e in events if e['operation'] == 'write-attempt' and e['key'] == key]
                        returns = [e for e in events if e['operation'] == 'write-return' and e['key'] == key]
                        injected = [e for e in events if e.get('injected')]
                        check('one exact current-key candidate excludes legal same-byte no-op', len(attempts) == 1 and attempts[0]['before'] == original_raw and attempts[0]['value'] != original_raw and json.loads(attempts[0]['value'])['state'] == ready['state'], {'attempts': len(attempts)})
                        check('fault targets exactly one current-key operation', len(injected) == 1 and injected[0]['key'] == key and injected[0]['operation'] == ('write-throw' if fault == 'write-throw' else 'read-throw'), injected)
                        if fault == 'write-throw':
                            check('throw prevents native current write and preserves all storage bytes', not returns and primary.storage() == original_storage)
                        else:
                            check('write really succeeds before immediate application readback refusal', len(returns) == 1 and returns[0]['actual'] == attempts[0]['value'] == primary.raw() and events.index(returns[0]) < events.index(injected[0]))
                            check('readback failure retains previous complete state and changes envelope only', json.loads(primary.raw())['state'] == ready['state'] and primary.raw() != original_raw)
                            check('successful uncertain current write leaves every existing backup byte intact', [x for x in primary.storage() if x['key'] != key] == [x for x in original_storage if x['key'] != key])
                        primary.tab('arcade')
                    else:
                        other = Page(context, stage, 'second')
                        other.import_source('before_stop' if alias == 'equipped' else 'equipped')
                        expected_other = other.raw()
                        primary.page.wait_for_function('window.__ringProtection.events.some(e=>e.operation==="storage-event"&&e.trusted)')
                        events = primary.audit()
                        storage_events = [e for e in events if e['operation'] == 'storage-event']
                        check('same-origin second production tab supplies a real trusted current storage event', any(e['trusted'] and e['key'] == key and e['oldValue'] == original_raw and e['newValue'] == expected_other and e['url'] == args.url for e in storage_events), storage_events)
                        check('second tab update used normal confirmed native import with no fault', other.page.evaluate('window.__ringProtection.fault') is None and expected_other != original_raw and primary.raw() == expected_other)
                        stage['secondTabAudit'] = dump_json(case+'-second-native-audit.json', other.audit())
                    protected = primary.snapshot('protected')
                    mode = 'conflict' if fault == 'second-tab' else 'protected'
                    check('actual session mode and visible notice corroborate protection', protected['mode'] == mode and protected['visibleNotice'] and ('其他标签页' if fault == 'second-tab' else '原件已保留并受保护') in protected['noticeText'], {'mode': protected['mode'], 'notice': protected['noticeText'], 'status': protected['status']})
                    check('entering protection retains whole original economic state and original bytes', protected['state'] == ready['state'] and protected['protectedRaw'] == original_raw)
                    mismatches = [name for name in required if protected['controls'][name]['visible'] and not protected['controls'][name]['disabled']]
                    check('known misleading-enabled UI limitation is actually reproduced', set(required) <= set(mismatches), {'misleadingEnabled': mismatches, 'notASafetyPass': True})
                    check('known ready-disabled top-up stays disabled across protection', protected['controls']['topup']['disabled'] and protected['controls']['topup']['title'] == ready['controls']['topup']['title'])
                    stage['misleadingEnabledControls'] = mismatches
                    baseline_state, baseline_storage = protected['state'], protected['storage']
                    primary.export_original(original_raw, 'before-actions')
                    primary.page.evaluate('window.__ringProtection.events.length=0')
                    targets = ['manual-run', 'manual-all', 'bet-plus', 'bet-minus', 'clear', 'auto-arm' if alias == 'equipped' else 'auto-stop']
                    for name in targets:
                        before = len(primary.audit())
                        primary.click(CONTROLS[name])
                        after = primary.snapshot('after-'+name)
                        action_events = primary.audit()[before:]
                        check('misleading enabled target receives genuine browser click: '+name, any(e['operation'] == 'ui-click' and e['trusted'] and (e.get('action') or e.get('ring')) == ('arcade-bet' if name.startswith('bet-') else 'arcade-bet-clear' if name == 'clear' else 'arcade-topup' if name == 'topup' else 'arcade-'+name.removeprefix('manual-') if name.startswith('manual-') else name) for e in action_events))
                        check('guard rejects clicked action without any whole-state/native-byte change: '+name, after['state'] == baseline_state and after['storage'] == baseline_storage and after['mode'] == mode)
                        check('blocked action attempts no native save write: '+name, not any(e['operation'].startswith('write-') for e in action_events))
                    primary.type('#ring-auto-count', 2)
                    primary.type('#ring-auto-cap', '19555')
                    draft = primary.snapshot('after-enabled-inputs')
                    check('enabled protected inputs can edit drafts but cannot change economic state/storage', draft['state'] == baseline_state and draft['storage'] == baseline_storage)
                    primary.frame(3000)
                    check('actual autosave callback is present', primary.page.evaluate('window.__ringProtection.autosave()') == 1)
                    terminal = primary.snapshot('after-tick-autosave')
                    check('original application RAF after a 3-second clock advance and autosave leave protected state frozen', terminal['state'] == baseline_state and terminal['storage'] == baseline_storage and terminal['mode'] == mode)
                    check('all protected actions, draft edits, tick and autosave attempt zero writes', not any(e['operation'].startswith('write-') for e in primary.audit()))
                    stage['blockedActionAudit'] = dump_json(case+'-blocked-actions-native-audit.json', primary.audit())
                    stage['entryAudit'] = dump_json(case+'-entry-native-audit.json', events)
                    primary.export_original(original_raw, 'after-actions')
                    primary.page.screenshot(path=str(out / (case+'-protected.png')), full_page=True, timeout=7000)
                    stage['screenshot'] = {'file': case+'-protected.png', 'sha256': sha((out / (case+'-protected.png')).read_bytes())}
                    stage.update(completed=True, result='baselineKnownLimitationReproduced', handlerGuardVerified=True, uiCorrect=False)
                    flush()
                    context.close()
                    active = None
                    processes()
            check('all six independent fault/source stages reproduced the exact known limitation', len(report['stages']) == 6 and all(s['completed'] and s['result'] == 'baselineKnownLimitationReproduced' for s in report['stages']))
            check('no uncaught application errors or failed resource requests', not report['errors'] and not report['failedRequests'], {'errors': report['errors'], 'failedRequests': report['failedRequests']})
            report.update(completed=True, result='baselineKnownLimitationReproduced', uiCorrect=False)
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
                processes()
                browser.close()
            except BaseException as cleanup:
                report.setdefault('cleanupErrors', []).append(repr(cleanup))
                report.update(completed=False, result='failed')
        flush()
    return 0 if report['completed'] and report['result'] == 'baselineKnownLimitationReproduced' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
    parser.add_argument('--report', default='natural-ring-report.json')
    parser.add_argument('--output', default='ring-protection-evidence', help='Must be empty')
    parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA'))
    parser.add_argument('--expected-report-sha256', required=True)
    parser.add_argument('--expect', required=True, choices=('baseline-mismatch',))
    parser.add_argument('--chromium')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--owner-marker', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker and not args.owner_marker:
        parser.error('The worker is internal; run through the independent supervisor.')
    return worker(args) if args.worker else supervise(args)


if __name__ == '__main__':
    raise SystemExit(main())
