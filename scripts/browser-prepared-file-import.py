"""Prepared-file import across a REAL 15-second production autosave.

Only File.text's already-resolved native result is gated. Date, performance, RAF,
setInterval, confirm and every Storage method remain native and unwrapped. This
is deterministic injected file-result timing, NOT evidence that a natural disk
read happened to take 15 seconds. Native browser localStorage is initially seeded
with explicitly synthetic, unmodified engine-state fixtures via storage_state;
no runtime storage/engine writes are injected. Real HTTP and set_input_files(path)
are required. The old fixed build is a separate known-limitation reproduction,
never an import-success gate. Total native wall-clock budget is 90 seconds.
"""
import argparse
import asyncio
import copy
import hashlib
import json
import os
import platform
import shutil
import subprocess
import time
import traceback
from pathlib import Path
from urllib.parse import urljoin, urlparse

from playwright.async_api import async_playwright


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--before-url', default='http://127.0.0.1:4175/Infinity/')
parser.add_argument('--expected-before-sha', default='8c19d044fb3c38c601223cd55272c6570c08525d')
parser.add_argument('--expected-after-sha', default=os.environ.get('GITHUB_SHA'),
                    help='Exact after source SHA; defaults to GITHUB_SHA or local git HEAD')
parser.add_argument('--fixture', default='save-session-review-save.json')
parser.add_argument('--expected-revision', type=int, default=8)
parser.add_argument('--output', default='prepared-file-import-evidence')
parser.add_argument('--chromium', default=None)
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
started = time.monotonic()
report = {
    'completed': False, 'startedAt': int(time.time() * 1000),
    'classification': 'HTTP / native clocks, RAF, interval, confirm and localStorage / gated native File.text result',
    'scope': 'Deterministic file-result timing across a real >=15s autosave; not an uninjected natural disk race, OS suspension, or atomic cross-tab CAS proof.',
    'fileSelection': 'Playwright locator.set_input_files with a real on-disk synthetic JSON file; input/change isTrusted observations are recorded, not assumed.',
    'nativeExecution': 'Headless Chromium under Playwright defaults. No page clock/timer/visibility API emulation. This is not native hidden-tab throttling evidence.',
    'storageEvidence': 'Native CDP DOMStorage mutation events plus passive native storage reads, including the first terminal-status MutationObserver microtask. Modal handlers issue no renderer/CDP read. Import event oldValue is independently compared to the preserved backup. Events prove observable mutations, not attempted identical-value setItem calls.',
    'operationCorrelation': 'Case/operation IDs are harness scope tags for one native file selection. Native events are independently matched by origin, localStorage, current key, and exact terminal bytes; these IDs are not browser-supplied transaction IDs.',
    'boundsSeconds': {'work': 76, 'evidence': 5, 'browserCleanup': 3, 'whole': 90},
    'url': args.url, 'beforeUrl': args.before_url, 'expectedBeforeSha': args.expected_before_sha, 'expectedAfterSha': args.expected_after_sha,
    'checks': [], 'cases': [], 'errors': [], 'failedRequests': [], 'scriptAssets': [],
    'runtime': {'python': platform.python_version(), 'platform': platform.platform()},
}
cases = []
browser = None
background_tasks = set()
KEY = BACKUP = None
fixtures = None
incoming = None
incoming_path = None


def check(case, name, passed, detail=None):
    row = {'case': case, 'name': name, 'passed': bool(passed)}
    if detail is not None:
        row['detail'] = detail
    report['checks'].append(row)
    if not passed:
        raise AssertionError(f'{case}: {name}')


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest() if value is not None else None


def compact(value):
    """Keep native timestamps and hashes while excluding repeated whole saves."""
    if isinstance(value, list):
        return [compact(item) for item in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if key in ('raw', 'current', 'newValue', 'oldValue', 'nativeText') and isinstance(item, str):
                result[key + 'Sha256'] = sha(item)
                result[key + 'Bytes'] = len(item.encode())
            elif key == 'backups' and isinstance(item, dict):
                result[key] = {name: {'sha256': sha(raw), 'bytes': len(raw.encode())} for name, raw in item.items()}
            else:
                result[key] = compact(item)
        return result
    return value


def tracked(coro):
    task = asyncio.create_task(coro)
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)
    return task


PROBE = r"""(() => {
 if(location.protocol!=='http:' && location.protocol!=='https:')return;
 const key=__KEY__, backup=__BACKUP__, caseId=__CASE_ID__;
 const refs={date:Date.now, performance:performance.now, raf:requestAnimationFrame,
   interval:setInterval, timeout:setTimeout, confirm:window.confirm,
   get:Storage.prototype.getItem, set:Storage.prototype.setItem,
   remove:Storage.prototype.removeItem, clear:Storage.prototype.clear,
   file:File.prototype.text};
 const isNative=fn=>/\[native code\]/.test(Function.prototype.toString.call(fn));
 const p={startedWall:Date.now(),startedPerf:performance.now(),frames:0,lastFrame:null,
   statusChanges:[],terminalObservations:[],storageEvents:[],fileEvents:[],actionEvents:[],visibilityEvents:[],files:[],released:0,returned:0,
   initialVisibility:document.visibilityState};
 const raw=()=>refs.get.call(localStorage,key);
 const status=()=>document.querySelector('[data-bind="status"]')?.textContent ?? '';
 const backups=()=>{const found={};for(let i=0;i<localStorage.length;i++){
   const k=localStorage.key(i);if(k===backup||k?.startsWith(backup+'.'))found[k]=refs.get.call(localStorage,k);
 }return found;};
 p.integrity=()=>({date:Date.now===refs.date&&isNative(Date.now),
   performance:performance.now===refs.performance&&isNative(performance.now),
   raf:requestAnimationFrame===refs.raf&&isNative(requestAnimationFrame),
   interval:setInterval===refs.interval&&isNative(setInterval),
   timeout:setTimeout===refs.timeout&&isNative(setTimeout),
   confirm:window.confirm===refs.confirm&&isNative(window.confirm),
   storageGet:Storage.prototype.getItem===refs.get&&isNative(refs.get),
   storageSet:Storage.prototype.setItem===refs.set&&isNative(refs.set),
   storageRemove:Storage.prototype.removeItem===refs.remove&&isNative(refs.remove),
   storageClear:Storage.prototype.clear===refs.clear&&isNative(refs.clear),
   nativeFileReader:isNative(refs.file),storageInstance:localStorage instanceof Storage});
 p.snapshot=()=>({wall:Date.now(),perf:performance.now(),startedWall:p.startedWall,
   startedPerf:p.startedPerf,frames:p.frames,lastFrame:p.lastFrame,
   visibility:document.visibilityState,current:raw(),backups:backups(),status:status(),
   planet:document.querySelector('[data-bind="ov-planet"]')?.textContent,
   played:document.querySelector('[data-bind="played"]')?.textContent,
   integrity:p.integrity(),released:p.released,returned:p.returned,
   files:p.files.map(({release,...entry})=>entry),
   statusChanges:p.statusChanges,terminalObservations:p.terminalObservations,storageEvents:p.storageEvents,fileEvents:p.fileEvents,
   initialVisibility:p.initialVisibility,visibilityEvents:p.visibilityEvents,actionEvents:p.actionEvents});
 let previous='';
 new MutationObserver(()=>{const next=status();if(next===previous)return;previous=next;
   const observed={status:next,wall:Date.now(),perf:performance.now(),raw:raw()};
   p.statusChanges.push(observed);
   if(next==='已导入并存入本地'||next==='已取消文件导入，当前进度未改动'){
     const file=p.files[p.files.length-1];
     p.terminalObservations.push({...observed,caseId,operationId:file?.operationId??null,
       fileSelectedWall:file?.selectedWall??null,fileSelectedPerf:file?.selectedPerf??null,
       fileReturnedWall:file?.returnedWall??null,fileReturnedPerf:file?.returnedPerf??null,
       backups:backups(),integrity:p.integrity()});
   }
 }).observe(document,{subtree:true,childList:true,characterData:true});
 for(const type of ['input','change'])document.addEventListener(type,event=>{
   if(event.target?.matches?.('[data-bind="import-file"]'))p.fileEvents.push({type,
     trusted:event.isTrusted,wall:Date.now(),perf:performance.now()});
 },true);
 document.addEventListener('click',event=>{const action=event.target?.closest?.('[data-action]');
   if(action)p.actionEvents.push({action:action.dataset.action,trusted:event.isTrusted,wall:Date.now(),perf:performance.now()});},true);
 document.addEventListener('visibilitychange',event=>p.visibilityEvents.push({trusted:event.isTrusted,
   visibility:document.visibilityState,wall:Date.now(),perf:performance.now(),raw:raw()}));
 window.addEventListener('storage',event=>{if(event.storageArea===localStorage && event.key===key)
   p.storageEvents.push({trusted:event.isTrusted,wall:Date.now(),perf:performance.now(),
     key:event.key,newValue:event.newValue,oldValue:event.oldValue});});
 const count=now=>{p.frames++;p.lastFrame=now;refs.raf.call(window,count);};
 refs.raf.call(window,count);
 File.prototype.text=async function(){
   const entry={operationId:caseId+':file:'+(p.files.length+1),name:this.name,size:this.size,selectedWall:Date.now(),selectedPerf:performance.now(),ready:false};
   p.files.push(entry);
   const text=await refs.file.call(this); // Always perform the real native read.
   entry.nativeText=text;entry.ready=true;entry.readyWall=Date.now();entry.readyPerf=performance.now();
   await new Promise(resolve=>entry.release=()=>{entry.releasedWall=Date.now();entry.releasedPerf=performance.now();p.released++;resolve();});
   entry.returnedWall=Date.now();entry.returnedPerf=performance.now();p.returned++;
   return text; // Return the exact native result, without replacing its contents.
 };
 window.__preparedProbe=p;
})();"""


class Case:
    def __init__(self, name, url, mode, seeded=True, gate_group='main-correctness'):
        self.name, self.url, self.mode, self.seeded = name, url, mode, seeded
        self.context = self.page = self.cdp = None
        self.storage_events = []
        self.storage_changed = asyncio.Event()
        self.operation_id = None
        self.dialogs = []
        self.dialog_tasks = []
        self.dialog_done = asyncio.Event()
        self.release_info = None
        self.data = {'name': name, 'gateGroup': gate_group, 'mode': mode, 'seeded': seeded,
                     'snapshots': [], 'dialogs': self.dialogs, 'storageMutations': self.storage_events}
        cases.append(self)
        report['cases'].append(self.data)

    async def snapshot(self, label):
        value = await self.page.evaluate('window.__preparedProbe.snapshot()')
        self.data['snapshots'].append({'label': label, **value})
        check(self.name, f'{label}: clocks, scheduling, confirm and Storage remain native', all(value['integrity'].values()), value['integrity'])
        return value

    async def on_dialog(self, dialog):
        row = {'type': dialog.type, 'message': dialog.message, 'openedHostWall': int(time.time() * 1000)}
        self.dialogs.append(row)
        try:
            # No command needing a renderer response is issued while the modal is
            # open. The last pre-release native read supplies prompt metadata only.
            # Exact overwritten bytes are proved later by the native update event.
            if self.mode in ('accept', 'reject'):
                observed_raw = self.release_snapshot['current']
                observed = [event for event in self.storage_events if event.get('key') == KEY and 'newValue' in event]
                if observed:
                    observed_raw = observed[-1]['newValue']
                row['promptMetadataBaseline'] = {'current': observed_raw,
                    'basis': 'Latest already-observed native current bytes; not a modal-time read'}
                row['mutationsAlreadyObservedAtOpening'] = len(self.storage_events)
                current = json.loads(observed_raw)
                active = next(p for p in current['state']['planets'] if p['id'] == current['state']['activePlanetId'])
                wanted = [f"v{incoming['version']}/r{incoming['revision']}",
                          f"第 {current['state']['stats']['launches'] + 1} 轮",
                          f"{len(current['state']['planets'])} 颗星球", active['name'],
                          '读取期间产生的变化也会被替换', '保留当前已保存原件', '写入校验成功后才采用']
                check(self.name, 'native confirmation identifies source/current world and warns about replacement/backup/write verification',
                      dialog.type == 'confirm' and all(part in dialog.message for part in wanted), {'required': wanted, 'actual': dialog.message})
                check(self.name, 'pre-release baseline is current world with no backup, and none is observed at confirmation opening',
                      current['state']['planets'][0]['name'] != incoming['state']['planets'][0]['name']
                      and not self.release_snapshot['backups'] and not self.backup_mutations())
                # A real modal delay distinguishes a rejected rebase from ordinary RAF progress.
                await asyncio.sleep(0.8)
                row['beforeDecisionHostWall'] = int(time.time() * 1000)
                if self.mode == 'accept':
                    await dialog.accept()
                else:
                    await dialog.dismiss()
            else:
                row['unexpected'] = True
                await dialog.dismiss()
        except Exception as error:
            row['error'] = repr(error)
            try:
                await dialog.dismiss()
            except Exception:
                pass
        finally:
            row['returnedHostWall'] = int(time.time() * 1000)
            self.dialog_done.set()

    def record_storage_event(self, kind, event):
        storage_id = event.get('storageId', {})
        if storage_id.get('isLocalStorage') is not True or storage_id.get('securityOrigin') != self.origin:
            self.data['ignoredStorageEventCount'] = self.data.get('ignoredStorageEventCount', 0) + 1
            return
        self.storage_events.append({**event, 'kind': kind, 'case': self.name,
            'operationId': self.operation_id, 'hostWall': int(time.time() * 1000),
            'hostMonotonic': time.monotonic()})
        self.storage_changed.set()

    def attach(self, page):
        page.set_default_timeout(5000)
        page.set_default_navigation_timeout(10000)
        page.on('pageerror', lambda error: report['errors'].append({'case': self.name, 'error': str(error)}))
        page.on('requestfailed', lambda request: report['failedRequests'].append({
            'case': self.name, 'url': request.url, 'type': request.resource_type, 'failure': request.failure}))
        page.on('response', lambda response: tracked(self.asset(response)))
        page.on('dialog', lambda dialog: self.dialog_tasks.append(tracked(self.on_dialog(dialog))))

    async def asset(self, response):
        if response.request.resource_type != 'script':
            return
        try:
            body = await response.body()
            digest = hashlib.sha256(body).hexdigest()
            path = urlparse(response.url).path.removeprefix(urlparse(self.url).path)
            asset = {'case': self.name, 'url': response.url, 'releasePath': path,
                     'status': response.status, 'sha256': digest, 'bytes': len(body)}
            report['scriptAssets'].append(asset)
            check(self.name, 'actual HTTP script bytes match the pinned release manifest',
                  self.release_info is not None and self.release_info.get('files', {}).get(path) == digest, asset)
        except Exception as error:
            report['errors'].append({'case': self.name, 'asset': response.url, 'error': str(error)})

    async def boot(self):
        parsed = urlparse(self.url)
        check(self.name, 'real HTTP(S) endpoint required', parsed.scheme in ('http', 'https'))
        self.origin = f'{parsed.scheme}://{parsed.netloc}'
        values = {'infinity.ui.tab': 'save'}
        if self.seeded:
            seed = copy.deepcopy(fixtures['current'])
            # Refresh only envelope timestamps; never change a single engine-state field.
            seed['savedAt'] = seed['lastTickAt'] = int(time.time() * 1000)
            values[KEY] = json.dumps(seed, ensure_ascii=False, indent=2)
            self.data['seedRawSha256'] = sha(values[KEY])
        self.context = await browser.new_context(viewport={'width': 1440, 'height': 1000},
            storage_state={'cookies': [], 'origins': [{'origin': self.origin, 'localStorage': [
                {'name': key, 'value': value} for key, value in values.items()]}]})
        release_url = urljoin(self.url, 'release.json')
        response = await self.context.request.get(release_url, timeout=6000)
        check(self.name, 'release provenance is served successfully by actual HTTP', response.status == 200)
        self.release_info = await response.json()
        expected_sha = args.expected_before_sha if self.mode == 'old' else args.expected_after_sha
        self.data['servedRelease'] = {'url': release_url, 'expectedSourceSha': expected_sha, **self.release_info}
        check(self.name, 'served release sourceSha strictly matches the pinned before/after SHA',
              self.release_info.get('sourceSha') == expected_sha, self.data['servedRelease'])
        check(self.name, 'served release uses the current fixture format',
              self.release_info.get('saveVersion') == incoming['version']
              and self.release_info.get('saveRevision') == args.expected_revision)
        await self.context.add_init_script(PROBE.replace('__KEY__', json.dumps(KEY)).replace('__BACKUP__', json.dumps(BACKUP)).replace('__CASE_ID__', json.dumps(self.name)))
        self.page = await self.context.new_page()
        self.attach(self.page)
        self.cdp = await self.context.new_cdp_session(self.page)
        await self.cdp.send('DOMStorage.enable')
        for event_name in ('domStorageItemAdded', 'domStorageItemUpdated', 'domStorageItemRemoved', 'domStorageItemsCleared'):
            self.cdp.on('DOMStorage.' + event_name, lambda event, kind=event_name: self.record_storage_event(kind, event))
        response = await self.page.goto(self.url, wait_until='load')
        check(self.name, 'production page served successfully over HTTP', response is not None and response.status == 200)
        await self.page.locator('[data-bind="amount-metal"]').wait_for()
        await self.page.locator('[data-tab-panel="save"]').wait_for(state='visible')
        first = await self.snapshot('before selecting file')
        check(self.name, 'clean case has no pre-existing backup', not first['backups'])
        check(self.name, 'initial current slot matches case type', (first['current'] is not None) == self.seeded)
        self.operation_id = self.name + ':file:1'
        self.data['fileOperationId'] = self.operation_id
        await self.page.locator('[data-bind="import-file"]').set_input_files(str(incoming_path.resolve()))
        await self.page.wait_for_function('window.__preparedProbe.files.length===1 && window.__preparedProbe.files[0].ready')
        self.pending = await self.snapshot('native file read resolved and result gated')
        check(self.name, 'native selected file belongs to this case and this one file operation',
              len(self.pending['files']) == 1 and self.pending['files'][0]['operationId'] == self.operation_id)
        check(self.name, 'file result becomes pending before the first 15-second timer can run',
              self.pending['perf'] - self.pending['startedPerf'] < 12000
              and not any(row['status'] == '已自动保存' for row in self.pending['statusChanges']))
        check(self.name, 'real native File.text returned the exact selected fixture bytes',
              self.pending['files'][0]['nativeText'] == incoming_path.read_text())
        check(self.name, 'file selection reached real input/change listeners',
              any(row['type'] == 'change' for row in self.pending['fileEvents']), self.pending['fileEvents'])

    async def autosave(self):
        await self.page.wait_for_function("""() => {
            const p=window.__preparedProbe;
            return p.statusChanges.some(e=>e.status==='已自动保存' && e.perf>=p.files[0].readyPerf
              && e.perf-p.startedPerf>=14900);
        }""", timeout=33000)
        self.before_release = await self.snapshot('real 15-second autosave while native file result is pending')
        value = self.before_release
        rows = [r for r in value['statusChanges'] if r['status'] == '已自动保存' and r['perf'] >= value['files'][0]['readyPerf']]
        check(self.name, 'at least one real normal autosave happened after file reading and before release',
              bool(rows) and value['released'] == 0 and not self.dialogs and value['current'] != self.pending['current'])
        check(self.name, 'native wall and performance clocks advanced at least 15 seconds',
              value['wall'] - value['startedWall'] >= 14900 and value['perf'] - value['startedPerf'] >= 14900)
        check(self.name, 'no hidden-tab persistence or visibility transition can explain pending-import retirement',
              value['initialVisibility'] == 'visible' and value['visibility'] == 'visible'
              and not value['visibilityEvents'], value['visibilityEvents'])
        check(self.name, 'native simulation RAF advanced while preparation was pending', value['frames'] > self.pending['frames'] + 10)
        check(self.name, 'autosave retained current world and did not preserve a replacement backup',
              not value['backups'] and json.loads(value['current'])['state']['planets'][0]['name'] != incoming['state']['planets'][0]['name'])
        check(self.name, 'no other game action occurred while preparation was pending', not value['actionEvents'], value['actionEvents'])
        current_mutations = [event for event in self.storage_events if event.get('key') == KEY]
        check(self.name, 'the first and only current mutation is the normal 15-second autosave, excluding earlier background persistence',
              len(current_mutations) == 1 and current_mutations[0].get('newValue') == value['current'],
              compact(current_mutations))
        check(self.name, 'no backup mutation occurred before confirmation', not self.backup_mutations())

    def backup_mutations(self):
        return [e for e in self.storage_events if e.get('key') == BACKUP or e.get('key', '').startswith(BACKUP + '.')]

    def mutations_since(self, index):
        return [e for e in self.storage_events[index:] if e.get('key') == KEY or e.get('key') == BACKUP or e.get('key', '').startswith(BACKUP + '.')]

    async def release(self):
        # Save the native baseline before scheduling release, so the modal handler
        # already has metadata and never needs to ask the paused renderer for it.
        self.release_snapshot = await self.snapshot('immediately before native File.text result release')
        self.release_event_index = len(self.storage_events)
        await self.page.evaluate('() => {setTimeout(()=>window.__preparedProbe.files[0].release(),0);}')

    async def wait_for_release(self):
        await self.page.wait_for_function('''() => {
            const p=window.__preparedProbe,f=p.files[0];
            return p.released===1 && p.returned===1 && p.files.length===1
              && f.ready && Number.isFinite(f.releasedWall) && Number.isFinite(f.returnedWall)
              && f.releasedWall>=f.readyWall && f.returnedWall>=f.releasedWall;
        }''', timeout=5000)
        proof = await self.page.evaluate('''() => {
            const p=window.__preparedProbe,f=p.files[0];
            return {released:p.released,returned:p.returned,readyWall:f.readyWall,
              releasedWall:f.releasedWall,returnedWall:f.returnedWall,wall:Date.now(),perf:performance.now()};
        }''')
        self.data['gateCompletion'] = proof
        check(self.name, 'native File.text result gate released once and exact native-result promise returned',
              proof['released'] == 1 and proof['returned'] == 1
              and proof['readyWall'] <= proof['releasedWall'] <= proof['returnedWall'] <= proof['wall'], proof)

    async def settle_frames(self):
        await self.page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')

    async def click_manual_save(self, page):
        modal = page.locator('[data-bind="offline-modal"]')
        if await modal.is_visible():
            await page.locator('[data-action="dismiss-offline"]').click()
            await modal.wait_for(state='hidden')
            self.data.setdefault('manualSaveDismissals', []).append({
                'hostWall': int(time.time() * 1000),
                'method': 'Native Playwright click on actual dismiss-offline UI before intentional manual retirement'})
        await page.locator('[data-action="save"]').click()

    async def manual_save(self):
        await self.click_manual_save(self.page)
        return await self.snapshot('after explicit native-input manual save')

    def matching_import_updates(self, terminal):
        return [event for event in self.mutations_since(self.release_event_index)
            if event.get('kind') == 'domStorageItemUpdated' and event.get('key') == KEY
            and event.get('case') == self.name and terminal.get('caseId') == self.name
            and event.get('operationId') == self.operation_id == terminal.get('operationId')
            and event.get('storageId', {}).get('isLocalStorage') is True
            and event.get('storageId', {}).get('securityOrigin') == self.origin
            and event.get('newValue') == terminal['raw']]

    async def await_import_update(self, terminal):
        # Renderer terminal reads and browser-process DOMStorage notifications have
        # separate delivery queues. Wait on host-side events only, after the modal
        # has returned; never query the paused renderer or manufacture a mutation.
        began = time.monotonic()
        deadline = began + 3
        proof = {'operationId': self.operation_id, 'origin': self.origin,
                 'currentKey': KEY, 'terminalRawSha256': sha(terminal['raw']),
                 'startedHostWall': int(time.time() * 1000), 'maximumSeconds': 3}
        self.data['importUpdateArrivalBarrier'] = proof
        while not self.matching_import_updates(terminal):
            self.storage_changed.clear()
            if self.matching_import_updates(terminal):
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                await asyncio.wait_for(self.storage_changed.wait(), remaining)
            except asyncio.TimeoutError:
                break
        proof['elapsedSeconds'] = time.monotonic() - began
        updates = self.matching_import_updates(terminal)
        proof['matchingEvents'] = len(updates)
        check(self.name, 'native same-operation import notification arrived within the bounded host-only barrier',
              bool(updates), proof)
        return updates

    async def verify_dialog_result(self):
        await self.release()
        await asyncio.wait_for(self.dialog_done.wait(), 8)
        await asyncio.gather(*self.dialog_tasks)
        await self.wait_for_release()
        check(self.name, 'exactly one successful native confirmation was handled',
              len(self.dialogs) == 1 and not self.dialogs[0].get('error'))
        await self.settle_frames()
        after = await self.snapshot('after confirmation returned')
        latest = self.release_snapshot
        terminal_rows = [row for row in after['terminalObservations']
            if row.get('caseId') == self.name and row.get('operationId') == self.operation_id
            and row['status'] == ('已导入并存入本地' if self.mode == 'accept' else '已取消文件导入，当前进度未改动')]
        check(self.name, 'first terminal status microtask captured actual native current and backup bytes',
              len(terminal_rows) == 1 and all(terminal_rows[0]['integrity'].values()))
        terminal = terminal_rows[0]
        self.data['firstTerminalObservation'] = terminal
        selected_file = after['files'][0]
        check(self.name, 'terminal observation belongs to this selected file and occurs after its native result returned',
              selected_file['operationId'] == terminal['operationId'] == self.operation_id
              and terminal['fileSelectedWall'] == selected_file['selectedWall']
              and terminal['fileSelectedPerf'] == selected_file['selectedPerf']
              and terminal['fileReturnedWall'] == selected_file['returnedWall']
              and terminal['fileReturnedPerf'] == selected_file['returnedPerf']
              and terminal['wall'] >= selected_file['returnedWall']
              and terminal['perf'] >= selected_file['returnedPerf'])
        if self.mode == 'accept':
            accepted_raw = terminal['raw']
            accepted = json.loads(accepted_raw)
            import_updates = await self.await_import_update(terminal)
            check(self.name, 'one native current-update event exactly matches first successful persisted current bytes',
                  len(import_updates) == 1 and isinstance(import_updates[0].get('oldValue'), str), compact(import_updates))
            replaced_raw = import_updates[0]['oldValue']
            self.data['importCurrentUpdate'] = import_updates[0]
            check(self.name, 'acceptance persists exact complete incoming engine-state payload', accepted['state'] == incoming['state'])
            expected_raw = await self.page.evaluate('({source,savedAt,lastTickAt}) => JSON.stringify({...source,savedAt,lastTickAt},null,2)',
                {'source': incoming, 'savedAt': accepted['savedAt'], 'lastTickAt': accepted['lastTickAt']})
            check(self.name, 'entire persisted envelope matches native JS serialization of source with only fresh timestamps substituted',
                  accepted_raw == expected_raw, {'expectedRawSha256': sha(expected_raw), 'actualRawSha256': sha(accepted_raw)})
            check(self.name, 'backup is byte-for-byte the actual overwritten current from native update event oldValue',
                  len(terminal['backups']) == 1 and next(iter(terminal['backups'].values())) == replaced_raw
                  and after['backups'] == terminal['backups']
                  and replaced_raw != accepted_raw)
            check(self.name, 'acceptance uses a fresh paired clock after confirmation, never the file-selection clock',
                  accepted['savedAt'] == accepted['lastTickAt']
                  and accepted['savedAt'] >= self.dialogs[0]['beforeDecisionHostWall'] - 2
                  and accepted['savedAt'] <= terminal['wall'])
            check(self.name, 'native UI reported the verified import in its first terminal microtask', terminal['status'] == '已导入并存入本地')
            (out / f'{self.name}-synthetic-accepted.json').write_text(accepted_raw)
            (out / f'{self.name}-synthetic-overwritten-current-backup.json').write_text(replaced_raw)
            await self.page.reload(wait_until='load')
            await self.page.locator('[data-bind="amount-metal"]').wait_for()
            await self.settle_frames()
            reloaded = await self.manual_save()
            payload = json.loads(reloaded['current'])
            actual = float(payload['state']['totalTime']) - float(accepted['state']['totalTime'])
            accounted = (payload['lastTickAt'] - accepted['lastTickAt']) / 1000
            check(self.name, 'reload accounts post-adoption elapsed time once, without replaying the pending-read gap',
                  actual >= 0 and abs(actual - accounted) < 0.025,
                  {'simulationSeconds': actual, 'watermarkSeconds': accounted, 'toleranceSeconds': 0.025})
            check(self.name, 'reload keeps the imported world and exact preserved backup',
                  payload['state']['planets'][0]['name'] == incoming['state']['planets'][0]['name']
                  and reloaded['backups'] == after['backups'])
        else:
            check(self.name, 'rejection leaves current and backup bytes unchanged',
                  terminal['raw'] == latest['current'] and terminal['backups'] == latest['backups']
                  and after['current'] == latest['current'] and after['backups'] == latest['backups'])
            check(self.name, 'rejection performs no observable current/backup mutation', not self.mutations_since(self.release_event_index))
            check(self.name, 'native UI reports cancellation', after['status'] == '已取消文件导入，当前进度未改动')
            saved = await self.manual_save()
            before, after_save = json.loads(latest['current']), json.loads(saved['current'])
            actual = float(after_save['state']['totalTime']) - float(before['state']['totalTime'])
            accounted = (after_save['lastTickAt'] - before['lastTickAt']) / 1000
            check(self.name, 'rejection preserves the accounted clock including the real modal delay',
                  actual >= 0.7 and abs(actual - accounted) < 0.01,
                  {'simulationSeconds': actual, 'watermarkSeconds': accounted, 'modalDelaySeconds': 0.8, 'toleranceSeconds': 0.01})

    async def verify_stale(self):
        if self.mode == 'manual':
            self.before_release = await self.manual_save()
        elif self.mode == 'conflict':
            other = await self.context.new_page()
            self.attach(other)
            response = await other.goto(self.url, wait_until='load')
            check(self.name, 'real second tab served successfully', response is not None and response.status == 200)
            await self.click_manual_save(other)
            await self.page.wait_for_function("window.__preparedProbe.storageEvents.some(e=>e.trusted) && document.querySelector('[data-bind=\"status\"]').textContent.includes('其他标签页')")
            self.before_release = await self.snapshot('real other-tab native save created observed conflict')
            check(self.name, 'conflict comes from a trusted native storage event',
                  any(e['trusted'] for e in self.before_release['storageEvents']))
        await self.release()
        await self.wait_for_release()
        await self.page.wait_for_timeout(350)
        await self.settle_frames()
        after = await self.snapshot('stale native file completion settled')
        check(self.name, 'stale file completion opens no confirmation', not self.dialogs)
        check(self.name, 'stale file completion leaves current and backup bytes unchanged',
              after['current'] == self.before_release['current'] and after['backups'] == self.before_release['backups'])
        check(self.name, 'stale completion performs no observable current/backup mutation', not self.mutations_since(self.release_event_index))
        check(self.name, 'stale completion does not silently replace the status', after['status'] == self.before_release['status'])
        if self.mode == 'old':
            self.data['conclusion'] = 'KNOWN OLD LIMITATION REPRODUCED: autosave retires pending old file import; release gives no replacement and no confirmation. This is NOT old import success.'

    async def run(self):
        await self.boot()
        await self.autosave()
        if self.mode in ('accept', 'reject'):
            await self.verify_dialog_result()
        else:
            await self.verify_stale()
        self.data['completed'] = True


async def work():
    global KEY, BACKUP, fixtures, incoming, incoming_path, browser
    if args.expected_after_sha is None:
        args.expected_after_sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'],
            cwd=Path(__file__).resolve().parent.parent, text=True, timeout=2).strip()
    report['expectedAfterSha'] = args.expected_after_sha
    check('provenance', 'before and after expected SHAs are full forty-character hexadecimal values',
          all(isinstance(value, str) and len(value) == 40 and all(c in '0123456789abcdef' for c in value)
              for value in (args.expected_before_sha, args.expected_after_sha)))
    fixture_path = Path(args.fixture)
    fixtures = json.loads(fixture_path.read_text())
    KEY, BACKUP = fixtures['key'], fixtures['backupKey']
    incoming = fixtures['imported']
    report['fixture'] = {'path': str(fixture_path), 'sha256': hashlib.sha256(fixture_path.read_bytes()).hexdigest(),
        'description': fixtures.get('description'), 'engineStateChanges': 'None; existing synthetic current/imported state bytes only. Current envelope timestamps refreshed before initial storage_state.'}
    check('fixture', 'existing fixture explicitly identifies synthetic data', 'synthetic' in str(fixtures.get('description', '')).lower())
    check('fixture', 'current and imported fixtures use expected current revision; no startup migration',
          all(fixtures[name]['revision'] == args.expected_revision for name in ('current', 'imported')),
          {name: fixtures[name]['revision'] for name in ('current', 'imported')})
    check('fixture', 'current and imported fixtures distinguish their worlds',
          fixtures['current']['state']['planets'][0]['name'] != incoming['state']['planets'][0]['name'])
    incoming_path = out / 'synthetic-native-selected-import.json'
    incoming_path.write_text(json.dumps(incoming, ensure_ascii=False, indent=2))
    executable = args.chromium or shutil.which('chromium') or shutil.which('google-chrome')
    browser = await playwright.chromium.launch(headless=True, executable_path=executable, timeout=10000)
    report['runtime']['browser'] = browser.version
    selected = [
        Case('old-autosave-limitation', args.before_url, 'old', gate_group='old-known-limitation'),
        Case('new-held-accept', args.url, 'accept'),
        Case('new-empty-accept', args.url, 'accept', seeded=False),
        Case('new-reject', args.url, 'reject'),
        Case('new-manual-retires', args.url, 'manual'),
        Case('new-conflict-retires', args.url, 'conflict'),
    ]
    results = await asyncio.gather(*(item.run() for item in selected), return_exceptions=True)
    for item, result in zip(selected, results):
        if isinstance(result, BaseException):
            item.data['failure'] = repr(result)
            report['errors'].append({'case': item.name, 'error': repr(result)})
    if background_tasks:
        await asyncio.wait_for(asyncio.gather(*list(background_tasks), return_exceptions=True), 4)
    report['mainCorrectnessPassed'] = all(c.data.get('completed', False) for c in selected if c.mode != 'old')
    report['oldKnownLimitationReproduced'] = selected[0].data.get('completed', False)
    check('suite', 'new main correctness gate passed independently of the old limitation', report['mainCorrectnessPassed'])
    check('suite', 'fixed before-build reproduced its known limitation', report['oldKnownLimitationReproduced'])
    check('suite', 'no uncaught browser/script/handler errors', not report['errors'], report['errors'])
    check('suite', 'no failed production resource requests', not report['failedRequests'], report['failedRequests'])
    report['completed'] = True


async def evidence(item):
    if item.page is None or item.page.is_closed():
        return
    try:
        await asyncio.wait_for(item.snapshot('finally native audit'), 2)
    except Exception as error:
        item.data['finalSnapshotError'] = repr(error)
    try:
        filename = f'{item.name}-final.png'
        await item.page.screenshot(path=str(out / filename), full_page=True, timeout=1800)
        item.data['screenshot'] = filename
    except Exception as error:
        item.data['screenshotError'] = repr(error)


async def main():
    global playwright
    manager = async_playwright()
    playwright = None
    try:
        playwright = await asyncio.wait_for(manager.start(), 10)
        await asyncio.wait_for(work(), timeout=max(1, 76 - (time.monotonic() - started)))
    except BaseException as error:
        report['completed'] = False
        report['failure'] = repr(error)
        report['traceback'] = traceback.format_exc()
    finally:
        try:
            await asyncio.wait_for(asyncio.gather(*(evidence(item) for item in cases)), 5)
        except BaseException as error:
            report['evidenceError'] = repr(error)
        if browser is not None:
            try:
                await asyncio.wait_for(browser.close(), 3)
            except BaseException as error:
                report['cleanupError'] = repr(error)
        try:
            if playwright is not None:
                await asyncio.wait_for(playwright.stop(), 2)
        except BaseException as error:
            report['playwrightCleanupError'] = repr(error)
        report['elapsedWallSeconds'] = time.monotonic() - started
        if report['elapsedWallSeconds'] > 90:
            report['completed'] = False
            report['budgetFailure'] = 'Exceeded 90 native wall-clock seconds'
        if any(not row['passed'] for row in report['checks']):
            report['completed'] = False
        report['passed'] = sum(row['passed'] for row in report['checks'])
        report['total'] = len(report['checks'])
        (out / 'prepared-file-import-report.json').write_text(json.dumps(compact(report), ensure_ascii=False, indent=2))
        print(json.dumps({key: report.get(key) for key in ('completed', 'mainCorrectnessPassed',
            'oldKnownLimitationReproduced', 'passed', 'total', 'elapsedWallSeconds', 'failure')}, ensure_ascii=False))
    return 0 if report['completed'] else 1


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
