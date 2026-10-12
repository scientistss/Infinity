"""CI-only natural NPC acceptance with actual production HTTP/V8/release identity.
Date/performance/RAF timestamps are controlled. Native localStorage, File.text,
confirmation, trusted input, rendering and reload remain actual browser behavior.
Separate fault branches explicitly wrap native storage and never claim natural
quota exhaustion or unchanged disk after uncertain readback. No local run allowed.
"""
from npc_display_contract import MESSAGE_ROWS_SAMPLE_JS, assert_message_rows
from contextlib import contextmanager
from fractions import Fraction
import argparse
import copy
import hashlib
import json
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import traceback
from pathlib import Path
from urllib.parse import urljoin, urlparse
from playwright.sync_api import sync_playwright, expect

HOST_STARTED_MONOTONIC = time.monotonic()
HOST_STARTED_AT = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
NATIVE_RELOAD_CHECKPOINTS = ('attack7-paid-outbound', 'attack8-paid-outbound',
                             'win8-loot-delivered-once', 'empty10-zero-round-loot-delivered')


def native_reload_schedule_valid(report):
    """Reject a frequent-reload or ambiguously labeled oracle before browser use."""
    expected = {'name': 'native-four-reload-oracle', 'mode': 'native-main-four',
        'checkpointNames': list(NATIVE_RELOAD_CHECKPOINTS), 'strictRoundtripsPerCheckpoint': 2,
        'validation': 'detached-copies', 'candidateReadsPerReload': 1, 'controlReadsPerReload': 1,
        'blockedRetryAdoptsReload': False}
    if report.get('schema') != 'infinity-npc-attack-natural-route-v2' or not exact_json(report.get('reloadSchedule'), expected):
        return False
    if report.get('source', {}).get('reloadSchedule') != 'native-main-four':
        return False
    rows = report.get('milestones', [])
    names = [row.get('name') for row in rows]
    if len(rows) != 34 or len(set(names)) != 34:
        return False
    if [op.get('name') for op in report.get('tape', []) if op.get('kind') == 'checkpoint'] != names:
        return False
    if [name for name in names if name in NATIVE_RELOAD_CHECKPOINTS] != list(NATIVE_RELOAD_CHECKPOINTS):
        return False
    for row in rows:
        adopted = row['name'] in NATIVE_RELOAD_CHECKPOINTS
        if (not exact_json(row.get('strictRoundtrips'), 2) or row.get('stateAdoptedFromReload') is not adopted
                or not exact_json(row.get('candidateReloadReads'), int(adopted)) or not exact_json(row.get('controlReloadReads'), int(adopted))):
            return False
    blocked = report.get('branches', {}).get('blockedRetry', {})
    return blocked.get('stateAdoptedFromReload') is False and exact_json(blocked.get('strictRoundtrips'), 1)


def atomic_json(path, value):
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


class NativeCheckJournal:
    """Native-suite-only append log. No browser evidence is sampled or discarded."""
    def __init__(self, path):
        self.path = path
        self.fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_APPEND, 0o600)
        self.sequence, self.digest = 0, '0' * 64
        self.check_bytes, self.evidence_bytes = [], []
        self.error = None
        self.host_seconds = 0.0

    @staticmethod
    def encoded(value):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')

    def append(self, kind, value):
        if self.error is not None:
            raise OSError('Native evidence journal is poisoned: ' + self.error)
        started = time.monotonic()
        try:
            entry = {'sequence': self.sequence + 1, 'previousSha256': self.digest, 'kind': kind, 'value': value}
            encoded = self.encoded(entry)
            digest = hashlib.sha256(encoded).hexdigest()
            line = b'{"entry":' + encoded + b',"sha256":"' + digest.encode('ascii') + b'"}\n'
            offset = 0
            while offset < len(line):
                written = os.write(self.fd, line[offset:])
                if written <= 0 or written > len(line) - offset:
                    raise OSError('Native evidence journal made no write progress')
                offset += written
            # A failed assertion and its complete detail are durable before check
            # raises. Every successful event has the same durability contract.
            os.fsync(self.fd)
            self.sequence, self.digest = entry['sequence'], digest
        except BaseException as error:
            self.error = repr(error)
            raise
        finally:
            self.host_seconds += time.monotonic() - started

    def sync(self, checks, evidence, full=False):
        # Only native_horizontal_to mutates existing evidence: its current audit
        # and attempt rows. Persist that row at EVERY existing flush point, also
        # once when a following evidence row retires it. Full snapshots reconcile
        # every value at branch/failure/final boundaries.
        start = 0 if full else max(0, len(self.evidence_bytes) - 1)
        for index in range(start, len(evidence)):
            encoded = self.encoded(evidence[index])
            if index == len(self.evidence_bytes) or encoded != self.evidence_bytes[index]:
                self.append('evidence', {'index': index, 'record': evidence[index]})
                if index == len(self.evidence_bytes): self.evidence_bytes.append(encoded)
                else: self.evidence_bytes[index] = encoded
        start = 0 if full else len(self.check_bytes)
        for index in range(start, len(checks)):
            encoded = self.encoded(checks[index])
            if index < len(self.check_bytes) and encoded == self.check_bytes[index]:
                continue
            reference = None
            # Keep the original alias semantics without a generic object graph:
            # earlier check.details follow the later snapshots of this audit.
            if evidence and evidence[-1].get('kind') == 'native-scroll-region-preparation':
                audit, detail = evidence[-1], checks[index].get('detail')
                if detail is audit:
                    reference = {'evidence': len(evidence) - 1, 'attempt': None}
                else:
                    for attempt, row in enumerate(audit['attempts']):
                        if detail is row:
                            reference = {'evidence': len(evidence) - 1, 'attempt': attempt}
                            break
            self.append('check' if index == len(self.check_bytes) else 'check-update',
                        {'index': index, 'record': checks[index], 'detailRef': reference})
            if index == len(self.check_bytes): self.check_bytes.append(encoded)
            else: self.check_bytes[index] = encoded


def replay_native_journal(path):
    """Return the verified prefix, retaining a torn/corrupt journal unchanged."""
    report, checks, evidence, references = {}, [], [], {}
    sequence, digest, last, error = 0, '0' * 64, None, None
    try:
        with path.open('rb') as stream:
            for line in stream:
                if not line.endswith(b'\n'):
                    raise ValueError('unterminated journal record')
                envelope = json.loads(line)
                entry = envelope['entry']
                if (set(envelope) != {'entry', 'sha256'} or set(entry) != {'sequence', 'previousSha256', 'kind', 'value'}
                        or type(entry['sequence']) is not int or entry['sequence'] != sequence + 1
                        or entry['previousSha256'] != digest
                        or hashlib.sha256(NativeCheckJournal.encoded(entry)).hexdigest() != envelope['sha256']
                        or line != b'{"entry":' + NativeCheckJournal.encoded(entry)
                        + b',"sha256":"' + str(envelope['sha256']).encode('ascii') + b'"}\n'):
                    raise ValueError('journal sequence or checksum mismatch')
                kind, value = entry['kind'], entry['value']
                if kind in ('check', 'check-update', 'evidence'):
                    rows = evidence if kind == 'evidence' else checks
                    index = value['index']
                    if (type(index) is not int or index < 0 or index > len(rows)
                            or kind == 'check' and index != len(checks)
                            or kind == 'check-update' and index >= len(checks)):
                        raise ValueError('invalid journal record index')
                    record = value['record']
                    if not isinstance(record, dict):
                        raise ValueError('invalid journal record')
                    if kind != 'evidence' and type(record.get('passed')) is not bool:
                        raise ValueError('invalid assertion result')
                    ref = value.get('detailRef')
                    if kind != 'evidence' and ref is not None:
                        if (not isinstance(ref, dict) or set(ref) != {'evidence', 'attempt'}
                                or type(ref['evidence']) is not int or not 0 <= ref['evidence'] < len(evidence)):
                            raise ValueError('invalid native audit reference')
                        audit = evidence[ref['evidence']]
                        if (audit.get('kind') != 'native-scroll-region-preparation'
                                or ref['attempt'] is not None and (type(ref['attempt']) is not int
                                or not 0 <= ref['attempt'] < len(audit['attempts']))):
                            raise ValueError('invalid native audit attempt reference')
                        detail = audit if ref['attempt'] is None else audit['attempts'][ref['attempt']]
                        if record.get('detail') != detail:
                            raise ValueError('native audit detail reference differs from assertion')
                    # Validate all alias updates BEFORE touching the valid prefix.
                    updates = {}
                    if kind == 'evidence':
                        for check_index, old_ref in references.items():
                            if old_ref['evidence'] == index:
                                updates[check_index] = record if old_ref['attempt'] is None else record['attempts'][old_ref['attempt']]
                    if index == len(rows): rows.append(record)
                    else: rows[index] = record
                    if kind != 'evidence':
                        references.pop(index, None)
                        if ref is not None: references[index] = ref
                    else:
                        for check_index, detail in updates.items():
                            checks[check_index]['detail'] = detail
                elif kind == 'snapshot':
                    if not isinstance(value, dict) or 'checks' in value or 'evidence' in value:
                        raise ValueError('snapshot must not duplicate assertion arrays')
                    report = value
                elif kind == 'seal':
                    if (type(value['checkCount']) is not int or type(value['evidenceCount']) is not int
                            or value['checkCount'] != len(checks) or value['evidenceCount'] != len(evidence)):
                        raise ValueError('sealed record counts differ')
                else:
                    raise ValueError('unknown native journal record kind')
                sequence, digest, last = entry['sequence'], envelope['sha256'], entry
    except (OSError, ValueError, KeyError, IndexError, TypeError) as caught:
        error = repr(caught)
    report.update(checks=checks, evidence=evidence, passed=sum(row['passed'] for row in checks))
    return report, {'sequence': sequence, 'sha256': digest, 'error': error,
                    'seal': last['value'] if last is not None and last['kind'] == 'seal' and error is None else None}


def recover_native_report(journal_path, report_path, progress_path, worker_ok):
    report, journal = replay_native_journal(journal_path)
    valid = False
    try:
        full_bytes = report_path.read_bytes()
        full = json.loads(full_bytes)
        if not isinstance(full, dict):
            raise ValueError('full report must be a JSON object')
        valid = (journal['error'] is None and journal['seal'] is not None
                 and hashlib.sha256(full_bytes).hexdigest() == journal['seal']['reportSha256']
                 and full == report and full.get('completed') is True
                 and bool(report['checks']) and all(row['passed'] for row in report['checks']))
        # Only the explicitly marked recorder-failure fallback can supersede a
        # replay, and only when it names that exact verified prefix. A normal
        # older failure report must never hide newer journal diagnostics.
        if (not valid and full.get('recordingError') is not None
                and full.get('recordingCheckpoint') == {'sequence': journal['sequence'], 'sha256': journal['sha256']}):
            report = full
    except (OSError, ValueError, KeyError, TypeError) as caught:
        journal['reportError'] = repr(caught)
    if not (worker_ok and valid):
        report.update(completed=False, result='failed' if not worker_ok or journal['error'] else 'incomplete')
    report['recording'] = {'journal': journal_path.name, 'verifiedPrefixSequence': journal['sequence'],
        'verifiedPrefixSha256': journal['sha256'], 'replayError': journal['error'],
        'sealedReportVerified': valid, 'reconstructionComplete': bool(worker_ok and valid),
        'reportReadError': journal.get('reportError'),
        'boundary': 'Only a clean worker exit and a checksum-bound final full report prove completion. Raw journal is retained, including any invalid tail.'}
    emergency = report_path.with_name('npc-attack-recording-failure.json')
    if emergency.exists():
        report['recording']['emergencyFullReport'] = emergency.name
    if not valid and progress_path.exists():
        try:
            report['recording']['lastProgress'] = json.loads(progress_path.read_bytes())
        except (OSError, ValueError) as caught:
            report['recording']['progressReadError'] = repr(caught)
    return report


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture', default='npc-attack-native-report.json')
parser.add_argument('--natural-report', default='npc-attack-native-report.json')
parser.add_argument('--expected-report-sha256', required=True)
parser.add_argument('--release')
parser.add_argument('--output', default='npc-attack-evidence')
parser.add_argument('--chromium')
parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA'))
parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()
if os.environ.get('CI') != 'true' or os.environ.get('GITHUB_ACTIONS') != 'true':
    parser.error('Native NPC browser acceptance is CI-only; local execution is not authorized.')
if not args.expected_sha or not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha):
    parser.error('--expected-sha (or GITHUB_SHA) must pin the exact 40-character commit')
if not re.fullmatch(r'[0-9a-f]{64}', args.expected_report_sha256):
    parser.error('--expected-report-sha256 must independently pin the complete natural report')
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
report_path = out / 'npc-attack-browser-report.json'
journal_path = out / 'npc-attack-checks.jsonl'
progress_path = out / 'npc-attack-progress.json'
if not args.worker:
    if any(out.iterdir()):
        raise SystemExit('Use an empty --output directory; failed or prior evidence must remain separate.')
    atomic_json(report_path, {'completed': False, 'result': 'starting', 'checks': []})
    owned = {}

    def process_info(pid):
        try:
            fields = Path(f'/proc/{pid}/stat').read_text().rsplit(') ', 1)[1].split()
            return {'pid': pid, 'birth': fields[19], 'state': fields[0], 'parent': int(fields[1])}
        except (OSError, IndexError, ValueError):
            return None

    def collect(root):
        pending, visited = [root, *owned], set()
        while pending:
            pid = pending.pop()
            if pid in visited:
                continue
            visited.add(pid); info = process_info(pid)
            if info is None or (pid in owned and owned[pid] != info['birth']):
                continue
            owned[pid] = info['birth']
            for children in Path(f'/proc/{pid}/task').glob('*/children'):
                try:
                    pending.extend(int(value) for value in children.read_text().split())
                except OSError:
                    pass

    def terminate(sig):
        for pid, birth in reversed(list(owned.items())):
            info = process_info(pid)
            if info and info['birth'] == birth:
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass

    expired, code = False, 1
    with (out / 'worker.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen([sys.executable, __file__, *sys.argv[1:], '--worker'],
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + 910
        try:
            while True:
                collect(process.pid)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    expired = True; break
                try:
                    code = process.wait(timeout=min(.2, remaining)); break
                except subprocess.TimeoutExpired:
                    pass
        finally:
            collect(process.pid); terminate(signal.SIGTERM)
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            time.sleep(.1); terminate(signal.SIGKILL); process.wait(timeout=2)
    residual = [info for pid, birth in owned.items() if (info := process_info(pid)) and info['birth'] == birth]
    live_residual = [info for info in residual if info['state'] not in ('Z', 'X')]
    report = recover_native_report(journal_path, report_path, progress_path, not (expired or code or live_residual))
    if expired or code or live_residual:
        report.update(completed=False, result='external watchdog timeout' if expired else 'failed')
    report['workerExitCode'] = code
    report['supervisorHostElapsedSeconds'] = time.monotonic() - HOST_STARTED_MONOTONIC
    report['processCleanup'] = {'observedProcessCount': len(owned), 'terminalObservedResiduals': residual,
        'terminalObservedLiveCount': len(live_residual), 'terminalObservedZombieCount': sum(info['state'] == 'Z' for info in residual),
        'method': 'Only observed worker descendants with matching PID/start-time are signaled; unrelated processes are untouched.',
        'boundary': 'Sampled descendant observation cannot prove absence of unobserved fast-orphaned processes. Zombies are reported as residuals, never described as zero descendants.'}
    atomic_json(report_path, report)
    print(json.dumps({'completed': report.get('completed', False), 'passed': report.get('passed', 0),
                      'case': report.get('case'), 'report': str(report_path), 'observedResiduals': residual}, ensure_ascii=False))
    sys.exit(code if code else (0 if report.get('completed') else 1))

fixture_bytes = Path(args.fixture).read_bytes()
fixture_sha256 = hashlib.sha256(fixture_bytes).hexdigest()
fixtures = json.loads(fixture_bytes)
fixtures['source']['reportSha256'] = fixture_sha256
KEY, HOME, COLONY = fixtures['key'], fixtures['homeId'], fixtures['colonyId']
parsed = urlparse(args.url)
if parsed.scheme not in ('http', 'https'):
    raise ValueError('Acceptance requires actual HTTP(S) production URL')
ORIGIN = f'{parsed.scheme}://{parsed.netloc}'
checks, errors, failed_requests, evidence, source_bindings = [], [], [], [], []
page_sources, release_metadata = {}, None
completed, active_page, source_sha, failure = False, None, None, None
case, branch_metrics = 'setup', {}
journal = NativeCheckJournal(journal_path)
last_progress_at = 0.0
recorder_host_seconds = 0.0
main_reload_checkpoints = []
CARD, QUEUE = '#space-messages', '#space-fleets'
WALLET_TOLERANCE = 1e-7
CLOCK = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window);
 const saved=sessionStorage.getItem('npc-clock');
 const epoch=saved?Number(saved):__EPOCH__;let elapsed=0;
 Date.now=()=>epoch+elapsed;Object.defineProperty(performance,'now',{value:()=>elapsed});
 // Read-only native-frame observer: deliberately bypass the controlled RAF
 // wrapper and expose its real callback timestamp, without advancing elapsed.
 let observerFrame=0;
 window.__npcObserveFrame=({selector,timeoutMs})=>new Promise(resolve=>{
   const observe=(nativeFrameTimestamp,observerTimedOut)=>{
     const element=document.querySelector(selector),r=element?.getBoundingClientRect();
     return {nativeFrameSequence:observerFrame,nativeFrameTimestamp,observerTimedOut,controlledElapsed:elapsed,
       geometry:{scrollX,scrollY,width:innerWidth,height:innerHeight,
         documentWidth:document.scrollingElement.scrollWidth,documentHeight:document.scrollingElement.scrollHeight,
         rect:r?{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}:null}};
   };
   const guard=setTimeout(()=>{caf(frame);resolve(observe(null,true));},timeoutMs);
   const frame=raf(timestamp=>{clearTimeout(guard);observerFrame++;resolve(observe(timestamp,false));});
 });
 window.__npcFrameCount=0;
 window.requestAnimationFrame=callback=>raf(()=>{window.__npcFrameCount++;callback(elapsed);});
 window.__npcAdvance=async ms=>{const beforeAt=epoch+elapsed;elapsed+=ms;sessionStorage.setItem('npc-clock',String(epoch+elapsed));await new Promise(raf);await new Promise(raf);return{beforeAt,afterAt:epoch+elapsed};};
 window.__npcNative=[Storage.prototype.getItem,Storage.prototype.setItem,File.prototype.text,window.confirm,window.setTimeout,window.setInterval].every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn)));
 window.__npcDrags=[];for(const type of ["dragstart","drop","dragend"])document.addEventListener(type,event=>window.__npcDrags.push({type,trusted:event.isTrusted,slot:event.target.closest?.("[data-slot]")?.dataset.slot||null}),true);
 window.__npcClicks=[];window.__npcEdits=[];window.__npcFiles=[];window.__npcWheels=[];window.__npcStorage=[];
 document.addEventListener('click',event=>{const b=event.target.closest?.('button');if(b)window.__npcClicks.push({action:b.dataset.action||b.dataset.orderAction||b.dataset.buildingTemplateAction||b.dataset.tab||(b.hasAttribute("data-demolish")?"demolition-preview":b.hasAttribute("data-demolition-confirm")?"demolition-confirm":b.hasAttribute("data-demolition-dismiss")?"demolition-dismiss":b.hasAttribute("data-cancel-demolition")?"demolition-cancel":null),id:b.dataset.id||b.id,trusted:event.isTrusted});},true);
 for(const type of ['input','change'])document.addEventListener(type,event=>{if(event.target.matches?.('select,input'))window.__npcEdits.push({id:event.target.id,type,trusted:event.isTrusted,value:event.target.value});},true);
 document.addEventListener('wheel',event=>{const region=event.target.closest?.('.space-table-scroll');
   window.__npcWheels.push({trusted:event.isTrusted,deltaY:event.deltaY,deltaX:event.deltaX,clientX:event.clientX,clientY:event.clientY,
     target:{tag:event.target.tagName,id:event.target.id,className:event.target.className},
     scrollRegion:region?{index:[...document.querySelectorAll('.space-table-scroll')].indexOf(region),
       targetContained:region.contains(event.target),scrollLeft:region.scrollLeft,scrollWidth:region.scrollWidth,clientWidth:region.clientWidth}:null});
 },{capture:true,passive:true});
 document.addEventListener('change',event=>{if(event.target.matches?.('[data-bind="import-file"]'))window.__npcFiles.push({trusted:event.isTrusted,name:event.target.files[0]?.name,size:event.target.files[0]?.size,priorRaw:localStorage.getItem(__KEY__)});},true);
 window.addEventListener('storage',event=>{if(event.storageArea===localStorage&&event.key===__KEY__)window.__npcStorage.push({trusted:event.isTrusted,oldValue:event.oldValue,newValue:event.newValue});});
})();'''.replace('__ORIGIN__', json.dumps(ORIGIN)).replace('__KEY__', json.dumps(KEY))


def begin_case(label):
    global case
    now = time.monotonic()
    if case in branch_metrics:
        branch_metrics[case]['_hostEnded'] = now
        flush(full=True)
    case = label
    branch_metrics[case] = {'_hostStarted': now, '_hostEnded': None,
        'attemptedAdvanceCalls': 0, 'successfulAdvanceCalls': 0, 'zeroAdvanceCalls': 0,
        'liveOneSecondAdvanceCalls': 0, 'simulatedSeconds': 0, 'advanceInFlight': None}


def timing_report():
    now = time.monotonic()
    branches = [{key: value for key, value in metrics.items() if not key.startswith('_')} | {
        'case': label, 'hostElapsedSeconds': (metrics['_hostEnded'] or now) - metrics['_hostStarted'],
        'hostStartOffsetSeconds': metrics['_hostStarted'] - HOST_STARTED_MONOTONIC,
        'hostEndOffsetSeconds': None if metrics['_hostEnded'] is None else metrics['_hostEnded'] - HOST_STARTED_MONOTONIC,
    } for label, metrics in branch_metrics.items()]
    return {'hostStartedAt': HOST_STARTED_AT, 'workerHostElapsedSeconds': now - HOST_STARTED_MONOTONIC,
        'hostClock': 'Python monotonic, independent of the controlled browser clock',
        'reportRecorder': {'hostSecondsBeforeCurrentFlush': recorder_host_seconds,
            'journalAppendAndSyncSeconds': journal.host_seconds,
            'scope': 'Host report recording only; browser actions and native frame waiting remain unchanged.'},
        'mode': 'Date/performance/RAF timestamps simulated. Positive advances are 500/1000ms and original live tick runs; native timers remain unchanged. Imported envelopes retain their original clocks; main-loop reload has zero saved gap; separate true cold-start branch uses a declared ten-second controlled wall gap.',
        'successfulAdvanceCalls': sum(row['successfulAdvanceCalls'] for row in branches),
        'zeroAdvanceCalls': sum(row['zeroAdvanceCalls'] for row in branches),
        'liveOneSecondAdvanceCalls': sum(row['liveOneSecondAdvanceCalls'] for row in branches),
        'simulatedSeconds': sum(row['simulatedSeconds'] for row in branches), 'branches': branches,
        'uncertainty': 'An unfinished advance remains advanceInFlight and is not counted as observed simulated time.'}


def advance(page, milliseconds=0):
    if milliseconds not in (0, 500, 1000):
        raise ValueError('Acceptance only permits zero-time UI frames or exact half/one-second live advances')
    metrics = branch_metrics[case]
    metrics['attemptedAdvanceCalls'] += 1
    metrics['advanceInFlight'] = {'requestedMilliseconds': milliseconds,
        'hostStartOffsetSeconds': time.monotonic() - HOST_STARTED_MONOTONIC}
    observed = page.evaluate('(ms)=>window.__npcAdvance(ms)', milliseconds)
    if observed['afterAt'] - observed['beforeAt'] != milliseconds:
        raise AssertionError('Actual controlled clock delta differs from requested advance')
    metrics['successfulAdvanceCalls'] += 1
    metrics['zeroAdvanceCalls'] += int(milliseconds == 0)
    metrics['liveOneSecondAdvanceCalls'] += int(milliseconds == 1000)
    metrics['simulatedSeconds'] += (observed['afterAt'] - observed['beforeAt']) / 1000
    metrics['advanceInFlight'] = None


def tab(page, name):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()
    page.locator(f'[data-tab="{name}"]').click(); advance(page)


def raw(page):
    return page.evaluate('(key)=>window.__npcNativeRead?window.__npcNativeRead(key):localStorage.getItem(key)', KEY)


def storage(page):
    return page.evaluate('Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,(window.__npcNativeRead?window.__npcNativeRead(k):localStorage.getItem(k))]))')


def read(page):
    return json.loads(raw(page))['state']


def planet(state, ident=HOME):
    return next(value for value in state['planets'] if value['id'] == ident)


def trusted_click(page, selector):
    native_scroll_to(page, selector)
    before = page.evaluate('window.__npcClicks.length'); page.locator(selector).click(); advance(page)
    events = page.evaluate('(n)=>window.__npcClicks.slice(n)', before)
    check('actual user input produces exactly one trusted button click', len(events) == 1 and events[0]['trusted'], events)


def select(page, selector, value):
    field = page.locator(selector); before = field.input_value()
    index = field.evaluate('(e,value)=>[...e.options].findIndex(option=>option.value===value)', value)
    check(selector + ': requested native option exists', index >= 0)
    count = page.evaluate('window.__npcEdits.length'); field.focus(); field.press('Home')
    for _ in range(index):
        field.press('ArrowDown')
    field.press('Tab'); advance(page)
    events = page.evaluate('(n)=>window.__npcEdits.slice(n)', count)
    check(selector + ': native keyboard selects exact option with trusted change', field.input_value() == value and
          (before == value or any(event['id'] == (field.get_attribute('id') or '') and event['type'] == 'change' and event['trusted'] for event in events)), events)


def exact_json(left, right):
    if type(left) is not type(right):
        # JSON has one number type. Integers and nonintegral numbers still
        # compare numerically; booleans never borrow numeric equality.
        return type(left) in (int, float) and type(right) in (int, float) and left == right
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(exact_json(left[k], right[k]) for k in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(exact_json(a, b) for a, b in zip(left, right))
    return left == right


def whole_state(name, actual, expected):
    same = exact_json(actual, expected)
    if not same:
        atomic_json(out / (name + '-actual-state.json'), actual); atomic_json(out / (name + '-expected-state.json'), expected)
    check(name + ': every serialized game field equals independent NPC oracle plus byte-pinned eef legacy engine', same,
          {'actualSha256': hashlib.sha256(json.dumps(actual, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
           'expectedSha256': hashlib.sha256(json.dumps(expected, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
           'scope': 'Full state: wallets, natural production, historical plans/IDs, timers, fleets, messages and all other fields; no exclusions or tolerances'})


def record(page, name):
    path = out / (name + '.json'); path.write_text(raw(page), encoding='utf-8')
    evidence.append({'case': case, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}); flush()


def snap(page, name):
    page.evaluate('Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))')
    path = out / name; page.screenshot(path=str(path), full_page=False, timeout=7000)
    evidence.append({'case': case, 'file': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}); flush()


def visibility(page, selectors):
    return page.evaluate('''selectors=>({viewport:{width:innerWidth,height:innerHeight},scrollY,targets:selectors.map(selector=>{
      const e=document.querySelector(selector),r=e.getBoundingClientRect(),s=getComputedStyle(e);
      const points=[[r.x+3,r.y+3],[r.right-3,r.y+3],[r.x+3,r.bottom-3],[r.right-3,r.bottom-3],[r.x+r.width/2,r.y+r.height/2]].map(([x,y])=>{
       const hit=document.elementFromPoint(x,y);return{x,y,unoccluded:!!hit&&(hit===e||e.contains(hit)),hit:hit?{tag:hit.tagName,id:hit.id}:null};});
      return{selector,text:e.innerText,rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},
       visible:r.width>6&&r.height>6&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0,
       contained:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,disabled:!!e.disabled,points};})})''', selectors)


def attach(page):
    page.set_default_timeout(7000); page.set_default_navigation_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: failed_requests.append(request.url))
    capture = {'responses': [], 'executed': [], 'cdp': page.context.new_cdp_session(page)}
    page_sources[page] = capture
    page.on('response', lambda response: capture['responses'].append(response)
            if response.request.resource_type in ('script', 'stylesheet') else None)
    capture['cdp'].send('Network.enable'); capture['cdp'].send('Network.setCacheDisabled', {'cacheDisabled': True})
    capture['cdp'].on('Debugger.scriptParsed', lambda event: capture['executed'].append(event)
                        if event.get('url', '').startswith(('http://', 'https://')) else None)
    capture['cdp'].send('Debugger.enable')


def verify_bundle(page):
    global source_sha, release_metadata
    if release_metadata is None:
        release_url = args.release or urljoin(args.url, 'release.json')
        check('release URL belongs to exact tested origin', f'{urlparse(release_url).scheme}://{urlparse(release_url).netloc}' == ORIGIN)
        response = page.request.get(release_url)
        check('release is actual HTTP 200 from requested URL', response.status == 200 and response.url == release_url)
        release_metadata = response.json(); source_sha = release_metadata.get('sourceSha')
        check('release pins exact mandatory tested commit', source_sha == args.expected_sha, source_sha)
        check('release save schema matches strict natural fixture', release_metadata.get('saveVersion') == fixtures['base']['version'] and release_metadata.get('saveRevision') == fixtures['base']['revision'])
        atomic_json(out / 'release.json', release_metadata)
    capture = page_sources[page]
    files = {urljoin(args.url, name): (name, expected) for name, expected in release_metadata['files'].items()}
    rows, bodies, executed = [], {}, []
    for response in capture['responses']:
        name, expected = files.get(response.url, (None, None))
        check('actual asset response belongs to pinned release', name is not None and response.status == 200 and response.url == response.request.url,
              {'type': response.request.resource_type, 'status': response.status, 'finalURL': response.url})
        body = response.body(); digest = hashlib.sha256(body).hexdigest(); bodies[response.url] = body
        row = {'type': response.request.resource_type, 'status': response.status, 'requestURL': response.request.url,
               'finalURL': response.url, 'releaseFile': name, 'bytes': len(body), 'httpSha256': digest, 'releaseSha256': expected}
        rows.append(row); check('complete served JS/CSS bytes match exact release hash', digest == expected, row)
        if not source_bindings:
            (out / ('served-' + Path(name).name)).write_bytes(body)
    check('real production JS and CSS responses were both captured', any(row['type'] == 'script' for row in rows) and any(row['type'] == 'stylesheet' for row in rows))
    for event in capture['executed']:
        url = event['url']; name, expected = files.get(url, (None, None))
        check('actual V8-executed HTTP script has matching pinned HTTP response', name is not None and url in bodies, url)
        source = capture['cdp'].send('Debugger.getScriptSource', {'scriptId': event['scriptId']})['scriptSource']
        digest = hashlib.sha256(source.encode('utf-8')).hexdigest()
        row = {'url': url, 'scriptId': event['scriptId'], 'releaseFile': name,
               'executedSourceSha256': digest, 'httpSha256': hashlib.sha256(bodies[url]).hexdigest(), 'releaseSha256': expected}
        check('read-only V8 source equals complete HTTP bytes and pinned release', digest == row['httpSha256'] == expected, row)
        executed.append(row)
        if not source_bindings:
            (out / ('executed-' + Path(name).name)).write_text(source, encoding='utf-8')
    check('real production script was observed executing in V8', bool(executed))
    source_bindings.append({'case': case, 'page': len(source_bindings) + 1, 'httpAssets': rows, 'executedScripts': executed,
                            'classification': 'Read-only CDP source inspection; no interception, inline bundle or game-state globals'})
    capture['cdp'].send('Debugger.disable'); flush()


def verify_document_response(response):
    body = response.body(); digest = hashlib.sha256(body).hexdigest()
    expected = release_metadata['files']['index.html']
    check('complete original HTTP200 document body matches pinned release index.html', response.status == 200 and response.url == args.url and digest == expected,
          {'url': response.url, 'httpSha256': digest, 'releaseSha256': expected, 'bytes': len(body)})
    path = out / 'served-index.html'
    if not path.exists():
        path.write_bytes(body)


def text_leaf_visibility(page, selectors):
    return page.evaluate(r"""selectors=>{
      const rect=r=>({x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom});
      const clipValues=new Set(['hidden','clip','scroll','auto']);
      return {viewport:{width:innerWidth,height:innerHeight},scrollY,leaves:selectors.map(selector=>{
        const leaf=document.querySelector(selector);
        if(!leaf)return {selector,missing:true,passed:false};
        const ancestry=[];
        for(let node=leaf;node;node=node.parentElement){
          const s=getComputedStyle(node),b=node.getBoundingClientRect();
          const x=b.x+node.clientLeft,y=b.y+node.clientTop;
          const paintContain=s.contain.split(/\s+/).some(v=>['paint','strict','content'].includes(v));
          ancestry.push({tag:node.tagName,id:node.id,bind:node.dataset.bind||null,rect:rect(b),
            paddingClip:{x,y,right:x+node.clientWidth,bottom:y+node.clientHeight},
            overflowX:s.overflowX,overflowY:s.overflowY,clipX:clipValues.has(s.overflowX)||paintContain,
            clipY:clipValues.has(s.overflowY)||paintContain,contain:s.contain,clipPath:s.clipPath,
            legacyClip:s.clip,contentVisibility:s.contentVisibility,display:s.display,visibility:s.visibility,
            opacity:Number(s.opacity),textOverflow:s.textOverflow,whiteSpace:s.whiteSpace,
            lineClamp:s.getPropertyValue('-webkit-line-clamp'),scrollWidth:node.scrollWidth,
            clientWidth:node.clientWidth,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight});
        }
        const fragments=[];let sourceText='';
        const walker=document.createTreeWalker(leaf,NodeFilter.SHOW_TEXT);let node;
        while((node=walker.nextNode())){
          sourceText+=node.data;
          // Nonwhitespace character ranges avoid claiming that a bounding box
          // proves its text. Every real glyph fragment must fit every clip box.
          for(let offset=0;offset<node.data.length;){
            const glyph=String.fromCodePoint(node.data.codePointAt(offset)),end=offset+glyph.length;
            if(glyph.trim()){
              const range=document.createRange();range.setStart(node,offset);range.setEnd(node,end);
              const boxes=[...range.getClientRects()].map(rect);
              const parent=node.parentElement;
              const measurements=boxes.map(box=>{
                const x=box.x+box.width/2,y=box.y+box.height/2,hit=document.elementFromPoint(x,y);
                const viewportContained=box.x>=0&&box.y>=0&&box.right<=innerWidth&&box.bottom<=innerHeight;
                const clips=ancestry.filter(a=>a.clipX||a.clipY).map(a=>({tag:a.tag,id:a.id,bind:a.bind,
                  xFits:!a.clipX||(box.x>=a.paddingClip.x-0.5&&box.right<=a.paddingClip.right+0.5),
                  yFits:!a.clipY||(box.y>=a.paddingClip.y-0.5&&box.bottom<=a.paddingClip.bottom+0.5)}));
                return {rect:box,viewportContained,clips,unoccluded:!!hit&&(hit===parent||parent.contains(hit)),
                  hit:hit?{tag:hit.tagName,id:hit.id,bind:hit.dataset?.bind||null}:null};
              });
              fragments.push({glyph,boxes:measurements,passed:measurements.length>0&&measurements.every(m=>
                m.rect.width>0&&m.rect.height>0&&m.viewportContained&&m.unoccluded&&m.clips.every(c=>c.xFits&&c.yFits))});
            }
            offset=end;
          }
        }
        const stylesVisible=ancestry.every(a=>a.display!=='none'&&a.visibility==='visible'&&a.opacity>0&&a.contentVisibility!=='hidden');
        // Nonrectangular clipping cannot be proved by these rectangles, so fail
        // closed rather than calling such a text fragment fully visible.
        const rectangularClips=ancestry.every(a=>a.clipPath==='none'&&a.legacyClip==='auto'&&(!a.lineClamp||a.lineClamp==='none'||a.lineClamp==='0'));
        return {selector,text:leaf.innerText,sourceText,rect:rect(leaf.getBoundingClientRect()),ancestry,fragments,
          stylesVisible,rectangularClips,passed:stylesVisible&&rectangularClips&&fragments.length>0&&fragments.every(f=>f.passed)};
      })};
    }""", selectors)


def wait_for_scroll_settled(page, selector, region_selector=None):
    # A target entering the viewport does not mean its native smooth scroll has
    # stopped. Require four fresh native frames with exact complete geometry,
    # spanning >=150ms on both the native RAF and independent host clocks.
    # Nothing here changes CSS, input, elapsed game time or application methods.
    started = time.monotonic()
    samples, previous, identical, stable_host, stable_native = [], None, 0, None, None
    for attempt in range(33):
        remaining = 1600 - (time.monotonic() - started) * 1000
        if remaining <= 0:
            break
        current = page.evaluate('options=>window.__npcObserveFrame(options)',
                                {'selector': selector, 'timeoutMs': min(250, remaining)})
        if region_selector is not None:
            current['geometry']['scrollRegion'] = scroll_region_state(page, region_selector, selector)
        observed_at = time.monotonic()
        current['hostOffsetMilliseconds'] = (observed_at - started) * 1000
        samples.append(current)
        geometry = current['geometry']
        fresh = not current['observerTimedOut'] and current['nativeFrameTimestamp'] is not None and (
            previous is None or current['nativeFrameSequence'] > previous['nativeFrameSequence'] and
            current['nativeFrameTimestamp'] > previous['nativeFrameTimestamp'] and
            current['controlledElapsed'] == previous['controlledElapsed'])
        if not fresh or geometry['rect'] is None:
            check('scroll readiness requires a fresh native frame, unchanged game clock and mounted target', False,
                  {'selector': selector, 'samples': samples})
        if previous is not None and exact_json(previous['geometry'], geometry):
            identical += 1
        else:
            identical, stable_host, stable_native = 1, observed_at, current['nativeFrameTimestamp']
        host_span = (observed_at - stable_host) * 1000
        native_span = current['nativeFrameTimestamp'] - stable_native
        if identical >= 4 and host_span >= 150 and native_span >= 150 and current['hostOffsetMilliseconds'] <= 1600:
            check('native scroll and target geometry settle across four fresh frames and 150 ms', True,
                  {'selector': selector, 'samples': samples, 'stableSamples': identical,
                   'stableHostMilliseconds': host_span, 'stableNativeFrameMilliseconds': native_span,
                   'hostClock': 'Python monotonic; not the controlled browser clock'})
            return
        previous = current
        if attempt < 32:
            remaining = 1600 - (time.monotonic() - started) * 1000
            if remaining <= 0:
                break
            page.wait_for_timeout(min(50, remaining))
    check('native scroll and target geometry settle within 1600 ms bounded sampling', False, {'selector': selector, 'samples': samples})


def native_scroll_to(page, selector):
    wait_for_scroll_settled(page, selector)
    for _ in range(5):
        target = page.locator(selector); box = target.bounding_box()
        limits = target.evaluate('''element=>{
          const header=document.querySelector('.topbar');
          return {height:innerHeight,width:innerWidth,inTopbar:!!header&&header.contains(element),
            headerPosition:header?getComputedStyle(header).position:null,
            headerBottom:header?.getBoundingClientRect().bottom||0};}''')
        # Read actual viewport/hit evidence first. A topbar child or a floating
        # layer can be fully visible above headerBottom; header ancestry never
        # grants visibility and an arbitrary screenshot inset is not a clip.
        limits['top'] = 0 if limits['inTopbar'] or limits['headerPosition'] not in ('sticky', 'fixed') else max(0, limits['headerBottom'])
        check('target fits its actual complete viewport', box is not None and box['height'] <= limits['height'] and box['width'] <= limits['width'],
              {'selector': selector, 'box': box, 'limits': limits})
        proof = visibility(page, [selector])
        wholly_visible = len(proof['targets']) == 1 and all(item['visible'] and item['contained'] and len(item['points']) == 5 and all(point['unoccluded'] for point in item['points']) for item in proof['targets'])
        if wholly_visible:
            check('native target is wholly visible with five unoccluded hit-tests', True, proof)
            return
        # Only a failed real visibility proof invokes repositioning. Reserve the
        # sticky header for normal content, but never mistake it for an overlay
        # above an already fully hit-testable floating target.
        available = limits['height'] - limits['top']
        check('target fits its actual unobstructed viewport region', box['height'] <= available,
              {'selector': selector, 'box': box, 'limits': limits, 'failedVisibility': proof})
        target_y = limits['top'] + (available - box['height']) / 2
        page.mouse.move(limits['width'] - 12, limits['height'] - 12)
        page.mouse.wheel(0, round(box['y'] - target_y)); advance(page)
        wait_for_scroll_settled(page, selector)
    check('Actual wheel input could not expose the complete requested region with five unoccluded hit-tests', False,
          {'selector': selector, 'lastVisibility': visibility(page, [selector])})


def scroll_region_state(page, region_selector, target_selector):
    # Read-only DOM measurements. The region may be taller than the viewport.
    return page.evaluate(r"""({regionSelector,targetSelector})=>{
      const region=document.querySelector(regionSelector),target=document.querySelector(targetSelector);
      const rect=r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
      const client=e=>{const r=e.getBoundingClientRect();return {x:r.x+e.clientLeft,y:r.y+e.clientTop,
        right:r.x+e.clientLeft+e.clientWidth,bottom:r.y+e.clientTop+e.clientHeight};};
      const clips=[],clipValues=new Set(['hidden','clip','scroll','auto']);
      for(let node=region?.parentElement;node;node=node.parentElement){
        const s=getComputedStyle(node),paint=s.contain.split(/\s+/).some(v=>['paint','strict','content'].includes(v));
        clips.push({rect:client(node),clipX:clipValues.has(s.overflowX)||paint,clipY:clipValues.has(s.overflowY)||paint});
      }
      const header=document.querySelector('.topbar'),headerStyle=header&&getComputedStyle(header);
      const top=header&&['sticky','fixed'].includes(headerStyle.position)&&!header.contains(target)?Math.max(0,header.getBoundingClientRect().bottom):0;
      return {viewport:{width:innerWidth,height:innerHeight,top},scrollX,scrollY,clips,
        region:region?{rect:rect(region.getBoundingClientRect()),clientRect:client(region),
          index:[...document.querySelectorAll('.space-table-scroll')].indexOf(region),
          scrollLeft:region.scrollLeft,scrollWidth:region.scrollWidth,clientWidth:region.clientWidth,
          scrollTop:region.scrollTop,scrollHeight:region.scrollHeight,clientHeight:region.clientHeight}:null,
        target:target?{rect:rect(target.getBoundingClientRect()),insideRegion:!!region&&region.contains(target)}:null};
    }""", {'regionSelector': region_selector, 'targetSelector': target_selector})


def scroll_region_plan(state):
    # Pure geometry, also exercised offline. No screenshot padding or magic Y
    # clamp: every candidate lies strictly inside the actual visible client box.
    viewport, region, target = state['viewport'], state['region'], state['target']['rect']
    client = region['clientRect']
    left, right = max(0, client['x']), min(viewport['width'], client['right'])
    top, bottom = max(0, client['y']), min(viewport['height'], client['bottom'])
    for clip in state['clips']:
        if clip['clipX']:
            left, right = max(left, clip['rect']['x']), min(right, clip['rect']['right'])
        if clip['clipY']:
            top, bottom = max(top, clip['rect']['y']), min(bottom, clip['rect']['bottom'])
    # Native MouseEvent coordinates are integer CSS pixels. Use interior
    # integer candidates, and expose more of a subpixel-only sliver vertically.
    points = [{'x': math.floor(left + (right - left) * x), 'y': math.floor(top + (bottom - top) * y)}
              for y in (.5, .25, .75) for x in (.5, .25, .75)] if left < right and top < bottom else []
    points = [point for point in points if left < point['x'] < right and top < point['y'] < bottom]
    delta_x = target['x'] - left if target['x'] < left else target['right'] - right if target['right'] > right else 0
    delta_y = target['y'] + target['height'] / 2 - (viewport['top'] + viewport['height']) / 2
    return {'clip': {'x': left, 'y': top, 'right': right, 'bottom': bottom}, 'points': points,
        'targetFitsX': target['width'] <= right - left,
        'targetFitsY': target['height'] <= viewport['height'] - viewport['top'],
        'targetContainedX': left <= target['x'] and target['right'] <= right,
        'targetContainedY': top <= target['y'] and target['bottom'] <= bottom,
        'deltaX': math.ceil(delta_x) if delta_x > 0 else math.floor(delta_x),
        'deltaY': math.ceil(delta_y) if delta_y > 0 else math.floor(delta_y)}


def scroll_pointer_hits(page, region_selector, points):
    return page.evaluate("""({selector,points})=>{const region=document.querySelector(selector);
      return points.map(point=>{const hit=document.elementFromPoint(point.x,point.y);
        return {...point,insideRegion:!!region&&!!hit&&(hit===region||region.contains(hit)),
          hit:hit?{tag:hit.tagName,id:hit.id,className:hit.className}:null};});
    }""", {'selector': region_selector, 'points': points})


def horizontal_wheel_proven(before, after, point, delta, events):
    # A trusted delta alone is insufficient: the event itself must hit this
    # container, and its actual scroll offset must progress in that direction.
    if after['region'] is None or after['target'] is None or not after['target']['insideRegion']:
        return False
    clip = scroll_region_plan(before)['clip']
    return (point['insideRegion'] and clip['x'] < point['x'] < clip['right']
        and clip['y'] < point['y'] < clip['bottom'] and delta != 0
        and (after['region']['scrollLeft'] - before['region']['scrollLeft']) * delta > 0
        and (before['target']['rect']['x'] - after['target']['rect']['x']) * delta > 0
        and bool(events) and all(event['trusted'] and event['deltaX'] == delta and event['deltaY'] == 0
            and event['clientX'] == point['x'] and event['clientY'] == point['y']
            and event.get('scrollRegion') is not None and event['scrollRegion']['targetContained']
            and event['scrollRegion']['index'] == before['region']['index'] for event in events))


def native_horizontal_to(page, region_selector, target_selector):
    audit = {'case': case, 'kind': 'native-scroll-region-preparation', 'regionSelector': region_selector,
             'targetSelector': target_selector, 'attempts': []}
    evidence.append(audit); flush()
    wait_for_scroll_settled(page, target_selector, region_selector)
    # Bound actual input attempts, not the height of the table. Prepare the
    # requested row vertically and expose its column using the existing scroller.
    for attempt in range(9):
        before = scroll_region_state(page, region_selector, target_selector)
        row = {'attempt': attempt + 1, 'before': before}; audit['attempts'].append(row); flush()
        check('scroll preparation retains the actual container and original descendant target',
              before['region'] is not None and before['target'] is not None and before['target']['insideRegion'], row)
        plan = scroll_region_plan(before)
        proof = visibility(page, [target_selector])
        hits = scroll_pointer_hits(page, region_selector, plan['points'])
        row.update(plan=plan, visibilityBefore=proof, pointerCandidates=hits); flush()
        check('requested target fits actual horizontal clip and unobstructed viewport height',
              plan['targetFitsX'] and plan['targetFitsY'], row)
        fully_visible = len(proof['targets']) == 1 and all(item['visible'] and item['contained']
            and len(item['points']) == 5 and all(point['unoccluded'] for point in item['points']) for item in proof['targets'])
        if plan['targetContainedX'] and plan['targetContainedY'] and fully_visible:
            check('native scroll preparation exposes the complete original target with all five hit points', True, row)
            return
        if attempt == 8:
            break  # Eight inputs at most, with the final resulting geometry checked.
        point = next((hit for hit in hits if hit['insideRegion']), None)
        horizontal = plan['targetContainedY'] and not plan['targetContainedX'] and point is not None
        if not horizontal:
            # This exposes a row/fragment, never asks a tall table to fit. Actual
            # document progress is checked below; an overlay cannot be ignored.
            point = {'x': math.floor(before['viewport']['width'] / 2),
                     'y': math.floor((before['viewport']['top'] + before['viewport']['height']) / 2)}
        page.mouse.move(point['x'], point['y'])
        before = scroll_region_state(page, region_selector, target_selector)
        plan = scroll_region_plan(before)
        point = scroll_pointer_hits(page, region_selector, [point])[0]
        delta_x, delta_y = (plan['deltaX'], 0) if horizontal else (0, plan['deltaY'])
        row.update(axis='horizontal' if horizontal else 'vertical', beforeWheel=before, pointer=point,
                   requestedDelta={'x': delta_x, 'y': delta_y}); flush()
        clip = plan['clip']
        check('wheel preparation uses an actual visible hit and a nonzero required delta',
              bool(point['hit']) and (delta_x != 0 or delta_y != 0) and (not horizontal or point['insideRegion']
              and clip['x'] < point['x'] < clip['right'] and clip['y'] < point['y'] < clip['bottom']), row)
        prior = page.evaluate('window.__npcWheels.length')
        row['wheelCountBefore'] = prior; flush()
        try:
            page.mouse.wheel(delta_x, delta_y)
            row['immediateAfter'] = scroll_region_state(page, region_selector, target_selector)
            row['immediateEvents'] = page.evaluate('(n)=>window.__npcWheels.slice(n)', prior); flush()
            wait_for_scroll_settled(page, target_selector, region_selector)
        finally:
            # Preserve raw input, offsets and target geometry even when the
            # native-frame settle assertion fails, before any progress assertion.
            row['after'] = scroll_region_state(page, region_selector, target_selector)
            row['events'] = page.evaluate('(n)=>window.__npcWheels.slice(n)', prior); flush()
        if horizontal:
            check('trusted horizontal wheel hits the exact container and advances its actual scrollLeft',
                  horizontal_wheel_proven(before, row['after'], point, delta_x, row['events']), row)
        else:
            check('trusted vertical preparation advances the document toward the requested row',
                  (row['after']['scrollY'] - before['scrollY']) * delta_y > 0 and bool(row['events'])
                  and all(event['trusted'] and event['deltaX'] == 0 and event['deltaY'] == delta_y
                          and event['clientX'] == point['x'] and event['clientY'] == point['y'] for event in row['events']), row)
    check('bounded native scroll preparation must fully expose the requested original target', False, audit)


def capture_failure(error, page=None):
    global completed, failure
    completed = False
    failure = {'case': case, 'error': repr(error), 'traceback': traceback.format_exc()}

    def attempt(label, action):
        try:
            action()
        except BaseException as capture_error:
            failure.setdefault('captureErrors', []).append({'step': label, 'error': repr(capture_error)})

    def artifact(name, data):
        path = out / name; path.write_bytes(data)
        evidence.append({'case': case, 'file': name, 'sha256': hashlib.sha256(data).hexdigest()})

    def capture_raw():
        failure['rawSave'] = raw(page)
        if failure['rawSave'] is not None:
            artifact('failure-raw-save.json', failure['rawSave'].encode('utf-8'))

    # Persist the original failure before diagnostics. A failed individual
    # capture must neither hide that error nor prevent the other evidence.
    attempt('original failure report', lambda: flush(full=True))
    if page is not None:
        attempt('raw save', capture_raw)
        for name, selector in [('card', CARD), ('queue', QUEUE), ('status', '[data-bind="status"]')]:
            attempt(name, lambda name=name, selector=selector: failure.__setitem__(name, page.locator(selector).all_text_contents()))
        attempt('scroll and wheel diagnostics', lambda: failure.__setitem__('scrollAndWheels', page.evaluate('({width:innerWidth,height:innerHeight,scrollY,scrollHeight:document.scrollingElement?.scrollHeight,wheelCount:window.__npcWheels?.length||0,wheels:window.__npcWheels?.slice(-200)||[]})')))
        # all_text_contents above intentionally retains hidden historical text.
        # Report visibility separately so it cannot be mistaken for shown work.
        attempt('diagnostic target visibility', lambda: failure.__setitem__('targetVisibility', page.evaluate("""selectors=>selectors.map(selector=>{
          const element=document.querySelector(selector);if(!element)return {selector,missing:true};
          const r=element.getBoundingClientRect(),s=getComputedStyle(element);
          return {selector,hidden:element.hidden,hiddenAncestor:!!element.closest('[hidden]'),
            display:s.display,visibility:s.visibility,rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},
            controls:[...element.querySelectorAll('button,input,select')].map(e=>({tag:e.tagName,id:e.id,disabled:e.disabled}))};
        })""", [CARD, QUEUE, '[data-bind="res-metal"]'])))
        attempt('DOM', lambda: artifact('failure-dom.html', page.content().encode('utf-8')))
        attempt('report before screenshot', lambda: flush(full=True))
        attempt('screenshot', lambda: artifact('failure.png', page.screenshot(full_page=False, timeout=2000)))
    attempt('final failure report', lambda: flush(full=True))


@contextmanager
def capture_live_failure():
    try:
        yield
    except BaseException as error:
        capture_failure(error, active_page)
        raise


def check(name, condition, detail=None):
    checks.append({'case': case, 'name': name, 'passed': bool(condition), **({'detail': detail} if detail is not None else {})})
    flush()
    if not condition:
        raise AssertionError(f'{case}: {name}')


def import_confirmation(value, progress):
    return (f'已读取存档 v{value["version"]}/r{value["revision"]}。\n'
            f'是否替换当前进度（{progress}）？\n'
            '读取期间产生的变化也会被替换。保留当前已保存原件，写入校验成功后才采用。')


def verify_conflict_refusal(before, after, status):
    check('real conflict import reports refusal and the required cold-refresh recovery boundary',
          status == '导入失败，当前进度未改动：检测到其他标签页修改了存档，已暂停写入。请先导出本页保留的原件，再刷新读取最新存档。', status)
    check('refused conflict import preserves every current, legacy and backup byte', exact_json(before, after))


def import_save(page, value, label, original_raw=None, expected=None, expected_conflict=False, displayed_progress=None):
    check('native handoff retains exact original zero-gap clocks', value['savedAt'] == value['lastTickAt'] == page.evaluate('Date.now()'))
    text = original_raw if original_raw is not None else json.dumps(value, ensure_ascii=False)
    check('file bytes decode to complete intended envelope without patching', exact_json(json.loads(text), value))
    path = out / f'native-import-{label}.json'; path.write_bytes(text.encode('utf-8'))
    tab(page, 'save')
    if page.locator('[data-action="save"]').is_enabled():
        page.locator('[data-action="save"]').click()
    before, before_storage, count, dialogs = raw(page), storage(page), page.evaluate('window.__npcFiles.length'), []
    if displayed_progress is None:
        current = read(page); selected = planet(current, current['activePlanetId'])
        displayed_progress = f'第 {current["stats"]["launches"] + 1} 轮，{len(current["planets"])} 颗星球，当前“{selected["name"]}”'
    confirmation = import_confirmation(value, displayed_progress)
    def answer(dialog):
        valid = dialog.type == 'confirm' and dialog.message == confirmation
        dialogs.append({'valid': valid, 'message': dialog.message}); dialog.accept() if valid else dialog.dismiss()
    page.once('dialog', answer)
    page.locator('[data-bind="import-file"]').set_input_files(str(path.resolve()))
    expect(page.locator('[data-bind="status"]')).to_contain_text('导入失败，当前进度未改动' if expected_conflict else '已导入并存入本地')
    files = page.evaluate('window.__npcFiles')
    check('real file selection/native asynchronous read/one explicit native confirmation', len(dialogs) == 1 and dialogs[0]['valid'] and len(files) == count + 1 and files[-1] == {'trusted': True, 'name': path.name, 'size': path.stat().st_size, 'priorRaw': before}, dialogs)
    if expected_conflict:
        verify_conflict_refusal(before_storage, storage(page), page.locator('[data-bind="status"]').inner_text())
        evidence.append({'case': case, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                         'classification': 'Real native file/confirmation rejected by the existing conflict session; never a successful recovery', 'nativeConfirmation': dialogs})
        building_tab(page)
        return
    wanted = expected if expected is not None else value
    whole_state('import-' + label, read(page), wanted['state'])
    check('entire adopted native envelope equals exact migration/unchanged handoff oracle', exact_json(json.loads(raw(page)), wanted))
    evidence.append({'case': case, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'classification': label, 'nativeConfirmation': dialogs})
    building_tab(page)


def prepare_protected_export(page, before):
    # Navigation has its own narrow preference-write contract. Never ignore UI
    # keys when asserting that the subsequent protected export writes nothing.
    check('protected export navigation starts from the complete unchanged overview storage',
          before.get('infinity.ui.tab') == 'overview' and exact_json(storage(page), before))
    trusted_click(page, '[data-tab="save"]')
    after = storage(page)
    check('overview to save changes only the exact tab preference; all other stored bytes remain identical',
          exact_json(after, {**before, 'infinity.ui.tab': 'save'}))
    return after


def export_protected(page, original, name):
    baseline = storage(page)
    check('protected export begins on the already selected save page',
          baseline.get('infinity.ui.tab') == 'save'
          and page.locator('[data-tab="save"]').get_attribute('aria-selected') == 'true')
    with page.expect_download() as pending:
        trusted_click(page, '[data-action="export"]')
    path = out / name; pending.value.save_as(str(path))
    check('protected real download exports byte-exact cached original', path.read_bytes() == original.encode())
    check('protected export preserves the complete save-page storage baseline without any key exception',
          exact_json(storage(page), baseline))
    evidence.append({'case': case, 'file': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})


def full_report():
    return {'completed': completed, 'result': 'passed' if completed else 'incomplete',
        'case': case, 'url': args.url, 'sourceSha': source_sha, 'fixture': fixtures['description'],
        'fixtureSha256': fixture_sha256, 'sourceReportSha256': fixtures['source']['reportSha256'],
        'originalR12SaveSha256': fixtures['origin']['rawSha256'],
        'oracleReloadSchedule': fixtures.get('reloadSchedule'), 'observedMainReloadCheckpoints': main_reload_checkpoints,
        'classification': 'Unedited public eef r12 66s two-scout save imported through the native file picker; complete r14 paid action/tick tape replay. Explicit native Storage fault wrappers and DOM mutation probes are separate branches. The three enumerated synthetic boundary fixtures separately change colony metal right to 0.25, landed LF count to 1e15, or colony name plus delivered report8 originId. None is part of the natural main; the identity fixture is not a native rename action or natural colony battle.',
        'responsiveScope': '320/390/768/1440 CLOSED compact summaries before detail expansion, actual frozen full-detail glyphs and controls; five real hit points, ancestor clipping, stable native scroll and exact screenshot geometry. One economic execution only, with route/clear/form/report four-width witnesses at real milestones.',
        'timing': timing_report(), 'oracle': 'Natural-main serialized fields equal pinned eef legacy engine plus independent NPC LF combat, loot, FNV, wallet, event and exact-decimal oracle. Curvature and abandonment have independent whole-state branch checks. Other boundary envelopes are real current-engine executions with separately asserted ownership, money and combat invariants. No game globals or source injection. Natural main is never economically patched; the explicitly synthetic branch fields are enumerated separately.',
        'nativeBoundary': 'Browser storage/file/dialog/HTTP are native. Date/performance/RAF timestamps are controlled. Fault-only Storage wrappers are explicit. This runner is not a genuine unmodified-clock background-throttling test.',
        'boundsSeconds': {'worker': 900, 'supervisor': 910}, 'checks': checks,
        'passed': sum(value['passed'] for value in checks), 'errors': errors, 'failedRequests': failed_requests,
        'sourceBindings': source_bindings, 'evidence': evidence, 'failure': failure}


def flush(full=False, final=False):
    global last_progress_at, recorder_host_seconds
    started = time.monotonic()
    try:
        try:
            journal.sync(checks, evidence, full=full)
            report = full_report()
            # Current case, native timing, errors and source identity remain
            # recoverable after every flush, without rewriting old check detail.
            journal.append('snapshot', {key: value for key, value in report.items() if key not in ('checks', 'evidence')})
            if full:
                atomic_json(report_path, report)
                if final:
                    journal.append('seal', {'reportSha256': hashlib.sha256(report_path.read_bytes()).hexdigest(),
                        'checkCount': len(checks), 'evidenceCount': len(evidence)})
        except BaseException:
            journal.error = journal.error or repr(sys.exc_info()[1])
            # Recording faults must not suppress the original failure, live DOM,
            # raw save, or screenshot capture. Never seal this fallback report.
            if full:
                report = full_report()
                report.update(completed=False, result='failed')
                report['recordingError'] = journal.error or traceback.format_exc()
                report['recordingCheckpoint'] = {'sequence': journal.sequence, 'sha256': journal.digest}
                atomic_json(report_path.with_name('npc-attack-recording-failure.json'), report)
                atomic_json(report_path, report)
            raise
        now = time.monotonic()
        if full or now - last_progress_at >= 1:
            atomic_json(progress_path, {'completed': False, 'case': case, 'checkCount': len(checks),
                'evidenceCount': len(evidence), 'lastCheckName': checks[-1]['name'] if checks else None,
                'journalSequence': journal.sequence, 'journalSha256': journal.digest,
                'hostElapsedSeconds': now - HOST_STARTED_MONOTONIC,
                'recorderHostSeconds': recorder_host_seconds + now - started,
                'journalWriteHostSeconds': journal.host_seconds})
            last_progress_at = now
    finally:
        recorder_host_seconds += time.monotonic() - started


def building_tab(page):
    # Compatibility name for the reused exact native file/confirmation helper.
    tab(page, 'overview')


def save(page, expected=None):
    tab(page, 'save'); trusted_click(page, '[data-action="save"]'); result = read(page)
    if expected is not None:
        whole_state(expected, result, fixtures['expected'][expected])
    return result


FAULT = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const key=__KEY__, fault=__FAULT__, get=Storage.prototype.getItem,set=Storage.prototype.setItem;
 const writes=new Set(); window.__npcFaultAudit=[];
 window.__npcNativeRead=k=>get.call(localStorage,k);
 const matches=k=>fault.target==='current'?k===key:k===key+'.backup'||k.startsWith(key+'.backup.');
 Storage.prototype.getItem=function(k){k=String(k);
   if(this===localStorage&&fault.operation==='readback'&&matches(k)&&writes.has(k)){
     window.__npcFaultAudit.push({kind:'readback-throw',key:k});throw new DOMException('Explicit NPC acceptance readback fault','SecurityError');
   }return get.call(this,k);
 };
 Storage.prototype.setItem=function(k,v){k=String(k);v=String(v);
   if(this!==localStorage)return set.call(this,k,v);
   if(fault.operation==='write'&&matches(k)){
     window.__npcFaultAudit.push({kind:'write-'+fault.mode,key:k,value:v});
     if(fault.mode==='throw')throw new DOMException('Explicit NPC acceptance quota fault','QuotaExceededError');
     if(fault.mode==='drop')return;
   }
   set.call(this,k,v);writes.add(k);window.__npcFaultAudit.push({kind:'write-return',key:k,value:v});
 };
})();'''


def boot(epoch, width=1440, initial_raw=None, fault=None):
    global active_page
    entries = [{'name': 'infinity.ui.tab', 'value': 'overview'},
               {'name': 'infinity.save.v1', 'value': 'EXPLICIT LEGACY SENTINEL: retain unchanged'}]
    if initial_raw is not None:
        entries.append({'name': KEY, 'value': initial_raw})
    context = browser.new_context(viewport={'width': width, 'height': 1100}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{'origin': ORIGIN, 'localStorage': entries}]})
    initialization = CLOCK.replace('__EPOCH__', str(epoch))
    if fault is not None:
        initialization += '\n' + FAULT.replace('__ORIGIN__', json.dumps(ORIGIN)).replace('__KEY__', json.dumps(KEY)).replace('__FAULT__', json.dumps(fault))
    context.add_init_script(initialization)
    page = context.new_page(); active_page = page; attach(page)
    response = page.goto(args.url, wait_until='networkidle')
    check('actual HTTP200 production document at exact URL', response is not None and response.status == 200 and response.url == args.url)
    verify_bundle(page); verify_document_response(response)
    check('Storage/File.text/dialog/timer functions were native before explicitly labeled optional fault wrapper', page.evaluate('window.__npcNative'))
    return context, page


def reload_same_time(page, expected):
    original = raw(page); envelope = json.loads(original)
    check('real reload begins at exact saved watermark', envelope['savedAt'] == envelope['lastTickAt'] == page.evaluate('Date.now()'))
    capture = page_sources[page]; capture['cdp'].send('Debugger.enable'); capture['responses'].clear(); capture['executed'].clear()
    response = page.reload(wait_until='networkidle'); verify_bundle(page); verify_document_response(response)
    check('native startup leaves complete original raw envelope unchanged before save', raw(page) == original)
    whole_state('same-time-reload-' + expected, save(page), fixtures['expected'][expected])
    record(page, 'same-time-reload-' + expected)


def input_number(page, selector, value):
    before = page.evaluate('window.__npcEdits.length')
    field = page.locator(selector); field.fill(str(value)); field.press('Tab'); advance(page)
    events = page.evaluate('(n)=>window.__npcEdits.slice(n)', before)
    check('native numeric edit uses trusted input and exact value: ' + selector,
          field.input_value() == str(value) and any(row['trusted'] and row['type'] == 'input' for row in events), events)


def timeout(_signal, _frame):
    raise TimeoutError('NPC attack native acceptance exceeded the 900-second worker bound')


signal.signal(signal.SIGALRM, timeout); signal.alarm(900)
begin_case('setup')

def snapshot_control(page, selector, filename, capture=True):
    native_scroll_to(page, selector)
    proof = visibility(page, [selector])
    check(filename + ': full viewport and five unobstructed hit points',
          all(row['visible'] and row['contained'] and all(p['unoccluded'] for p in row['points']) for row in proof['targets']), proof)
    glyphs = text_leaf_visibility(page, [selector])
    check(filename + ': every actual glyph fits viewport and ancestor clipping and is unoccluded',
          len(glyphs['leaves']) == 1 and all(leaf['passed'] for leaf in glyphs['leaves']), glyphs)
    check(filename + ': no page-level horizontal overflow', page.evaluate('document.scrollingElement.scrollWidth <= innerWidth'))
    if capture:
        snap(page, filename + '.png')


def route_attack(page):
    tab(page, 'galaxy'); trusted_click(page, '[data-space="home"]')
    selector = '[data-space="route"][data-mission="attack"][data-coordinate="1:56:6"]'
    native_horizontal_to(page, '[data-tab-panel="galaxy"] .space-table-scroll', selector)
    trusted_click(page, selector)
    check('native galaxy attack route fills mission and exact target',
          page.locator('#flight-mission').input_value() == 'attack' and [page.locator('#flight-' + key).input_value() for key in ('galaxy', 'system', 'position')] == ['1', '56', '6'])


def configure_fleet(page, mission, count=0):
    if mission == 'attack':
        route_attack(page)
    else:
        tab(page, 'fleet'); select(page, '#flight-mission', mission)
        for key, value in (('galaxy', 1), ('system', 56), ('position', 6)):
            input_number(page, '#flight-' + key, value)
    for ship in ('light_fighter', 'espionage_probe'):
        value = count if ship == 'light_fighter' and mission == 'attack' else 1 if ship == 'espionage_probe' and mission == 'scout' else 0
        field = page.locator('[data-ship="' + ship + '"]')
        if field.input_value() != str(value):
            input_number(page, '[data-ship="' + ship + '"]', value)
    expect(page.locator('#space-send')).to_be_enabled()
    check('outgoing quote does not expose unseen NPC resources or garrison',
          all(text not in page.locator('#space-quote').inner_text() for text in ('抵达时快照', '驻军战斗科技', '50000.000')))


def cargo_draft_witness(page):
    # Explicit user clearing is the only action that can alter these draft texts.
    before = save(page)
    for width in (320, 390, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
        tab(page, 'fleet'); select(page, '#flight-mission', 'transport')
        for resource, value in (('metal', '17'), ('crystal', 'bad'), ('deuterium', '3e0')):
            input_number(page, '#cargo-' + resource, value)
        route_attack(page)
        check(f'{width}px cargo switch preserves every original raw draft and makes it readonly',
              [page.locator('#cargo-' + r).input_value() for r in ('metal', 'crystal', 'deuterium')] == ['17', 'bad', '3e0']
              and all(page.locator('#cargo-' + r).evaluate('(e)=>e.readOnly||e.disabled') for r in ('metal', 'crystal', 'deuterium')))
        expect(page.locator('#space-send')).to_be_disabled()
        selector = '[data-space="attack-clear-cargo"]'; snapshot_control(page, selector, f'native-{width}-explicit-clear-cargo')
        trusted_click(page, selector)
        check('explicit clear makes precisely three zeros without a paid action', [page.locator('#cargo-' + r).input_value() for r in ('metal', 'crystal', 'deuterium')] == ['0', '0', '0'])
        whole_state(f'cargo-draft-only-{width}', save(page), before)
    page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page)


report_glyph_proofs = set()
compact_report_proofs = set()
COMPACT_REPORT_HOOKS = {
    'outcome': '.npc-report-result', 'route': '.npc-report-route',
    'lossText': '.npc-report-losses', 'lootText': '.npc-report-loot',
    'delivery': '.npc-report-delivery', 'timeText': '.npc-report-time',
    'roundText': '.npc-report-round-count',
}
COMPACT_BLOCKED_TEXT = '入港校验未通过，幸存舰船与货物仍在舰队。调整原出发星球库存或舰船数量后，请到舰队页重试入港。'


def compact_report_expected(receipt, state):
    """Independent literal oracle for this suite's LF-only, ordinary-time receipts.

    No production presenter, label registry, current wallet or current technology
    supplies a historical fact. Current planets supply only the origin identity.
    Unsupported fixture classes fail closed rather than borrowing app formatting.
    """
    battle = receipt['battle']
    before, after = battle['attackerBefore'], battle['attackerAfter']
    if not (set(before) | set(after)) <= {'light_fighter'}:
        raise AssertionError('Compact native oracle requires literal LF-only receipt')
    loss = before.get('light_fighter', 0) - after.get('light_fighter', 0)
    if type(loss) is not int or loss < 0:
        raise AssertionError('Compact native oracle requires nonnegative permanent loss')
    at = Fraction(str(receipt['at']))
    if not 0 <= at <= 10 ** 12:
        raise AssertionError('Compact native oracle requires ordinary nonnegative game time')
    seconds = at.numerator // at.denominator
    days, day_seconds = divmod(seconds, 86400)
    hours, hour_seconds = divmod(day_seconds, 3600)
    minutes, secs = divmod(hour_seconds, 60)
    duration = (f'{days} 天 {hours} 小时' if days else f'{hours} 小时 {minutes} 分' if hours
                else f'{minutes} 分 {secs} 秒' if minutes else f'{secs} 秒')
    def coordinates(value):
        return ':'.join(str(value[key]) for key in ('galaxy', 'system', 'position'))
    origin = next((world for world in state['planets'] if world['id'] == receipt['originId']), None)
    source = f'{origin["name"]} [{coordinates(origin["coordinates"])}]' if origin else '原出发星球已不可用'
    delivery = {'delivered': '已入港', 'destroyed': '全损', 'forfeited': '已丢弃'}.get(receipt['delivery'])
    if delivery is None:
        fleet = next((fleet for fleet in state['fleets'] if fleet['id'] == receipt['fleetId'] and fleet['mission'] == 'attack'), {})
        phase = fleet.get('npcAttack', {}).get('phase', {})
        delivery = ('入港受阻' if phase.get('dockBlocked') else '战后返航') if phase.get('kind') == 'returning' and phase.get('reason') == 'battle' else '交付状态不可确认'
    empty = not battle['rounds'] and all(count == 0 for count in battle['defenderBefore'].values())
    outcome = '无驻军收集' if empty else {'attacker': '胜', 'defender': '败', 'draw': '平'}[battle['winner']]
    loot = receipt['loot']
    if len(loot) != 3 or any(type(value) is not int or value < 0 for value in loot):
        raise AssertionError('Compact native oracle requires exact nonnegative integer loaded loot')
    return {'outcome': outcome, 'route': source + ' → [' + coordinates(receipt['target']) + ']',
        'lossText': f'我方永久损失：{loss} 艘',
        'lootText': f'实际装载：金属 {loot[0]} · 晶体 {loot[1]} · 重氢 {loot[2]}',
        'delivery': delivery, 'timeText': '游戏时间 ' + duration, 'roundText': f'{len(battle["rounds"])} 回合'}


def store_compact_screenshot(directory, data):
    """Deduplicate only byte-identical PNGs; every capture keeps a witness row."""
    digest = hashlib.sha256(data).hexdigest()
    path = directory / f'native-closed-{digest}.png'
    existed = path.exists()
    if existed:
        if path.read_bytes() != data:
            raise AssertionError('Content-addressed compact screenshot bytes differ')
    else:
        path.write_bytes(data)
    return {'file': path.name, 'sha256': digest, 'byteLength': len(data),
            'identicalBytesAlreadyStored': existed}


def closed_report_text(page, selector, receipt, wanted):
    node = page.locator(selector)
    summary = selector + ' > summary'
    if node.evaluate('(e)=>e.open'):
        native_scroll_to(page, summary)
        page.locator(summary).focus(); page.locator(summary).press('Enter'); advance(page)
    check('compact report is actually closed before any summary assertion', not node.evaluate('(e)=>e.open'))
    actual = {}
    for field, hook in COMPACT_REPORT_HOOKS.items():
        leaf = page.locator(summary + ' ' + hook)
        expect(leaf).to_have_count(1)
        actual[field] = leaf.inner_text()
    check('closed compact fields equal independent receipt facts and current origin identity', actual == wanted,
          {'fleetId': receipt['fleetId'], 'expected': wanted, 'actual': actual})
    check('closed compact report retains its exact receipt identifier',
          page.locator(summary + ' .npc-report-id').inner_text() == '#' + str(receipt['fleetId']))
    warning = page.locator(summary + ' .npc-report-blocked')
    expect(warning).to_have_count(1)
    blocked = wanted['delivery'] == '入港受阻'
    check('closed blocked hint is exact and appears only for the currently blocked receipt',
          warning.inner_text() == (COMPACT_BLOCKED_TEXT if blocked else '')
          and warning.evaluate('(e)=>e.hidden') is (not blocked))
    expect(page.locator(selector + ' > div')).not_to_be_visible()
    expect(page.locator(selector + ' > details[data-npc-rounds]')).not_to_be_visible()


def inspect_closed_report(page, selector, receipt, expected, label, widths=None):
    wanted = compact_report_expected(receipt, expected)
    signature = json.dumps(wanted, ensure_ascii=False, sort_keys=True)
    original_width = page.viewport_size['width']
    # One four-width witness per distinct displayed receipt state. Later exact
    # text assertions are not described as fresh screenshot/geometry evidence.
    pending = [width for width in (widths or (320, 390, 768, 1440))
               if (receipt['fleetId'], width, signature) not in compact_report_proofs]
    for width in pending or [original_width]:
        if page.viewport_size['width'] != width:
            page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
        closed_report_text(page, selector, receipt, wanted)
        if width not in pending:
            continue
        summary = selector + ' > summary'
        native_scroll_to(page, summary)
        geometry = visibility(page, [summary])
        check('closed summary fits viewport with all five real unobstructed hit points',
              len(geometry['targets']) == 1 and all(row['visible'] and row['contained']
              and len(row['points']) == 5 and all(point['unoccluded'] for point in row['points'])
              for row in geometry['targets']), geometry)
        selectors = [summary + ' ' + hook for hook in COMPACT_REPORT_HOOKS.values()]
        selectors += [summary + ' .npc-report-id', summary + ' .npc-report-details-hint']
        if wanted['delivery'] == '入港受阻':
            selectors.append(summary + ' .npc-report-blocked')
        glyphs = text_leaf_visibility(page, selectors)
        check('every CLOSED summary glyph is visible, unoccluded and inside viewport and ancestor clips',
              len(glyphs['leaves']) == len(selectors) and all(leaf['passed'] for leaf in glyphs['leaves']), glyphs)
        check('closed compact report has no document-level horizontal overflow',
              page.evaluate('document.scrollingElement.scrollWidth <= innerWidth'))
        check('summary remains closed at its actual screenshot geometry', not page.locator(selector).evaluate('(e)=>e.open'))
        page.evaluate('Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))')
        image = store_compact_screenshot(out, page.screenshot(full_page=False, timeout=7000))
        evidence.append({'case': case, 'kind': 'compact-closed-summary', 'label': label,
            'fleetId': receipt['fleetId'], 'width': width, 'expected': wanted, **image}); flush()
        compact_report_proofs.add((receipt['fleetId'], width, signature))
    if page.viewport_size['width'] != original_width:
        page.set_viewport_size({'width': original_width, 'height': 1100}); advance(page)


def report_body_glyphs(page, selector, receipt, label, width):
    proof_key = (width, json.dumps({key: value for key, value in receipt.items() if key != 'delivery'}, sort_keys=True))
    battle = receipt['battle']
    def count(value):
        # The natural main deliberately fights only LF; unsupported fleets fail
        # this independent literal presenter rather than inheriting app labels.
        check('natural report glyph oracle contains only literal light fighters', set(value) <= {'light_fighter'})
        return '轻型战斗机 ' + str(value['light_fighter']) if value.get('light_fighter') else '无'
    def losses(before, after):
        n = before.get('light_fighter', 0) - after.get('light_fighter', 0)
        return count({'light_fighter': n} if n else {})
    expected_body = [
        f'出发星球 {receipt["originId"]} → [1:56:6] · 实际游戏时间 {receipt["at"]} 秒',
        f'我方出征：{count(battle["attackerBefore"])}；永久损失：{losses(battle["attackerBefore"], battle["attackerAfter"])}；幸存：{count(battle["attackerAfter"])}',
        f'NPC 当时驻军：{count(battle["defenderBefore"])}；永久损失：{losses(battle["defenderBefore"], battle["defenderAfter"])}；幸存：{count(battle["defenderAfter"])}',
        f'实际装载：金属 {receipt["loot"][0]} · 晶体 {receipt["loot"][1]} · 重氢 {receipt["loot"][2]}。返抵原出发星球后一次结算；不足 1 的部分保留为该星球待结算权益，不计入普通可花库存。此处仍记录本场完整整数战利品，历史战报不可再次领取。',
        '本场我方武器 1 / 护盾 5 / 装甲 0；NPC 科技均为 0。出航货舱倍率 ×1.4。',
    ]
    check('all five historical report paragraphs match independent literal text',
          page.locator(selector + ' > div > p').all_inner_texts() == expected_body)
    if proof_key in report_glyph_proofs:
        return
    for index in range(1, 6):
        leaf = selector + f' > div > p:nth-child({index})'
        snapshot_control(page, leaf, f'{label}-{receipt["fleetId"]}-{width}-body-{index}', capture=index in (2, 4))
    rounds = selector + ' details[data-npc-rounds]'
    if not battle['rounds']:
        check('zero-round body explicitly says no combat', page.locator(rounds + ' > div').inner_text() == '无驻军收集，本次没有战斗回合。')
        snapshot_control(page, rounds + ' > div', f'{label}-{receipt["fleetId"]}-{width}-zero-rounds')
    else:
        region = rounds + ' > div.space-table-scroll'
        # Walk columns with the same real-container input/hit/offset evidence.
        for column, key in enumerate(('round', 'attacker', 'defender', 'attackDamage', 'defendDamage'), 1):
            first = rounds + f' tbody tr:first-child td:nth-child({column})'
            native_horizontal_to(page, region, first)
            for row, values in enumerate(battle['rounds'], 1):
                leaf = rounds + f' tbody tr:nth-child({row}) td:nth-child({column})'
                check('displayed round cell retains exact frozen numeric value',
                      Fraction(page.locator(leaf).inner_text()) == Fraction(str(values[key])))
                snapshot_control(page, leaf, f'{label}-{receipt["fleetId"]}-{width}-round-{row}-column-{column}', capture=row == 1)
    report_glyph_proofs.add(proof_key)


def inspect_reports(page, expected, label, four_widths=False, report_ids=None):
    before = save(page); tab(page, 'messages')
    reports = expected['npcBattles']['reports']
    for receipt in reports:
        if report_ids is not None and receipt['fleetId'] not in report_ids:
            continue
        tab(page, 'messages')
        selector = f'#npc-battle-reports details[data-npc-report="{receipt["fleetId"]}"]'
        node = page.locator(selector); expect(node).to_have_count(1)
        summary = selector + ' > summary'
        widths = (320, 390, 768, 1440) if four_widths else (page.viewport_size['width'],)
        inspect_closed_report(page, selector, receipt, expected, label)
        for width in widths:
            page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
            native_scroll_to(page, summary); page.locator(summary).focus(); page.locator(summary).press('Enter'); advance(page)
            if not node.evaluate('(e)=>e.open'):
                page.locator(summary).press('Space'); advance(page)
            check('keyboard activation opens the saved report', node.evaluate('(e)=>e.open'))
            rounds = selector + ' details[data-npc-rounds]'
            if not page.locator(rounds).evaluate('(e)=>e.open'):
                page.locator(rounds + ' > summary').focus(); page.locator(rounds + ' > summary').press('Enter'); advance(page)
            rows = page.locator(rounds + ' tbody tr').count()
            check('rendered round count equals frozen actual receipt', rows == len(receipt['battle']['rounds']))
            if four_widths:
                snapshot_control(page, summary, f'{label}-{receipt["fleetId"]}-{width}-report')
                snapshot_control(page, rounds + ' > summary', f'{label}-{receipt["fleetId"]}-{width}-rounds')
                report_body_glyphs(page, selector, receipt, label, width)
            handle = node.element_handle(); advance(page); check('ordinary repaint retains keyed open report node', handle.evaluate('(e)=>e.isConnected&&e.open'))
        whole_state(f'{label}-report-{receipt["fleetId"]}-readonly', save(page), before)
    page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page)


def verify_exact_money_witnesses():
    witnesses = fixtures['moneyWitnesses']
    check('natural report includes fuel and dock exact-money witnesses',
          any(w['kind'] == 'fuel-launch' for w in witnesses) and any(w['kind'] == 'loot-dock' and w['signedInteger'] > 0 for w in witnesses))
    for row in witnesses:
        source, prior, after, pending = [Fraction(row[key]) for key in ('beforeWallet', 'beforeRemainder', 'afterWallet', 'afterRemainder')]
        check('independent Python Fraction verifies original five-term equation',
              source + prior + row['signedInteger'] - after - pending == 0, row)
        check('independent Python verifies conservative main and strict subunit tail',
              0 <= pending < 1 and after <= source + prior + row['signedInteger'], row)
        check('fuel authorization uses ordinary wallet alone', row['signedInteger'] >= 0 or source >= -row['signedInteger'], row)
    for world in fixtures['base']['state']['planets']:
        check('native source migration begins with exactly zero tails on every actual planet',
              world['npcResourceRemainder'] == {'metal': '0', 'crystal': '0', 'deuterium': '0'})


def remainder_detail_witness(page, expected):
    before = save(page); tab(page, 'fleet')
    for world in expected['planets']:
        selector = '#space-planets [data-world-id="' + world['id'] + '"] .npc-resource-remainder'
        tails = world['npcResourceRemainder']
        if not any(value != '0' for value in tails.values()):
            expect(page.locator(selector)).to_have_count(0)
            continue
        expect(page.locator(selector)).to_have_count(1)
        exact_text = f'金属 {tails["metal"]} · 晶体 {tails["crystal"]} · 重氢 {tails["deuterium"]}'
        for width in (320, 390, 768, 1440):
            page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
            summary = selector + ' > summary'; native_scroll_to(page, summary)
            if not page.locator(selector).evaluate('(e)=>e.open'):
                page.locator(summary).focus(); page.locator(summary).press('Enter'); advance(page)
            check('pending rights expose exact per-resource strings separately from spendable wallet',
                  page.locator(selector + ' .npc-remainder-exact').inner_text() == exact_text
                  and '不计入普通可花库存' in page.locator(selector).inner_text())
            snapshot_control(page, selector + ' .npc-remainder-exact', f'native-{world["id"]}-{width}-exact-pending-rights')
        whole_state('remainder-detail-is-readonly-' + world['id'], save(page), before)
        tab(page, 'fleet')
    page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page)


def current_message_display(page, state):
    tab(page, 'messages')
    evidence = page.evaluate(MESSAGE_ROWS_SAMPLE_JS)
    valid = True
    try:
        assert_message_rows(evidence, state['messages'])
    except (AssertionError, KeyError, TypeError, ValueError):
        valid = False
    check('complete current message rows retain exact state order/text/time and typed-only rehearsal controls', valid, evidence)


def native_tape(page):
    report_widths_done, quote_widths_done, draft_done = False, False, False
    typed_message_ids_checked = set()
    for index, operation in enumerate(fixtures['tape']):
        kind = operation['kind']
        if kind == 'checkpoint':
            name = operation['name']; actual = save(page, name)
            typed_ids = {message['id'] for message in actual['messages'] if message['npcScoutSnapshot'] is not None}
            if typed_ids - typed_message_ids_checked:
                current_message_display(page, actual); typed_message_ids_checked.update(typed_ids)
            if name in NATIVE_RELOAD_CHECKPOINTS:
                reload_same_time(page, name); main_reload_checkpoints.append(name); record(page, 'native-' + name)
            if name == 'empty10-zero-round-loot-delivered':
                remainder_detail_witness(page, actual)
            if name == 'first-three-fighters-complete' and not draft_done:
                cargo_draft_witness(page); draft_done = True
            if actual['npcBattles']['reports']:
                first_delivered = not report_widths_done and any(r['delivery'] == 'delivered' for r in actual['npcBattles']['reports'])
                inspect_reports(page, fixtures['expected'][name], 'native-' + name, four_widths=first_delivered or name in ('win8-loot-delivered-once', 'empty10-zero-round-loot-delivered'))
                report_widths_done = report_widths_done or first_delivered
            for fleet in actual['fleets']:
                if fleet.get('npcAttack', {}).get('phase', {}).get('dockBlocked'):
                    tab(page, 'fleet'); selector = f'[data-space="npc-retry-dock"][data-fleet="{fleet["id"]}"]'
                    for width in (320, 390, 768, 1440):
                        page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
                        snapshot_control(page, selector, f'native-{name}-{width}-blocked-retry')
                    page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page)
            continue
        if kind == 'advance':
            check('main route uses actual bounded one-second native live ticks', operation['seconds'] == 1)
            advance(page, 1000)
        elif kind == 'research':
            tab(page, 'research'); trusted_click(page, '[data-bind="research-' + operation['tech'] + '"]')
        elif kind == 'build':
            tab(page, 'shipyard'); input_number(page, '[data-bind="uqty-' + operation['unit'] + '"]', operation['count'])
            trusted_click(page, '[data-bind="ubuild-' + operation['unit'] + '"]')
        elif kind in ('scout', 'attack'):
            before_send = save(page)
            configure_fleet(page, kind, operation.get('count', 0))
            if kind == 'attack' and not quote_widths_done:
                for width in (320, 390, 768, 1440):
                    page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
                    snapshot_control(page, '#space-send', f'native-{width}-paid-attack-controls')
                page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page); quote_widths_done = True
            trusted_click(page, '#space-send')
            if kind == 'attack':
                after_send = read(page)
                donor_before, donor_after = planet(before_send), planet(after_send)
                check('native paid attack obeys exact W+r fuel equation',
                      Fraction(donor_before['resources']['deuterium']) + Fraction(donor_before['npcResourceRemainder']['deuterium']) - operation['expectedFuel'] ==
                      Fraction(donor_after['resources']['deuterium']) + Fraction(donor_after['npcResourceRemainder']['deuterium']))
                check('native fuel leaves every other resource and right unchanged', all(donor_before['resources'][r] == donor_after['resources'][r] and donor_before['npcResourceRemainder'][r] == donor_after['npcResourceRemainder'][r] for r in ('metal', 'crystal')))
                check('successful native attack consumes ship draft exactly once', page.locator('[data-ship="light_fighter"]').input_value() == '0')
                expect(page.locator('#space-send')).to_be_disabled()
        elif kind == 'retry':
            tab(page, 'fleet'); trusted_click(page, f'[data-space="npc-retry-dock"][data-fleet="{operation["fleetId"]}"]')
        else:
            raise AssertionError('Unknown exact natural tape operation: ' + kind)
    check('actual natural scout arrivals received exact typed message DOM checks', typed_message_ids_checked == {'scout-6', 'scout-9'})
    check('exactly the four declared native main reloads completed in order', main_reload_checkpoints == list(NATIVE_RELOAD_CHECKPOINTS))
    check('full native paid route includes four-width draft/form/report witnesses', draft_done and quote_widths_done and report_widths_done)


def same_time_boundaries():
    # Cold browser startup from each unedited authentic natural milestone covers
    # outbound, positive pre-arrival, postbattle, blocked/delivered states.
    selected = []
    for row in fixtures['milestones']:
        state = row['save']['state']; attack = next((f for f in state['fleets'] if f['mission'] == 'attack'), None)
        if row['name'] in ('attack8-paid-outbound', 'win8-loot-delivered-once') or attack and (attack['returning'] or 0 < attack['remaining'] < 1):
            selected.append(row)
    signatures = set()
    for row in selected:
        attack = next((f for f in row['save']['state']['fleets'] if f['mission'] == 'attack'), None)
        signature = 'delivered' if not attack else ('blocked' if attack['npcAttack']['phase'].get('dockBlocked') else ('returning-loot' if any(Fraction(value) > 0 for value in attack['cargo'].values()) else 'returning-empty') if attack['returning'] else 'pre-arrival')
        if signature in signatures:
            continue
        signatures.add(signature); begin_case('native same-time cold reload: ' + signature)
        context, page = boot(row['save']['savedAt'], initial_raw=row['raw'])
        whole_state('cold-' + row['name'], save(page), row['save']['state']); reload_same_time(page, row['name']); context.close()


def recall_and_offline():
    branch = fixtures['branches']['recall']; begin_case('native outbound recall with no battle and no fuel refund')
    context, page = boot(branch['base']['savedAt'], initial_raw=branch['baseRaw'])
    advance(page, 1000); tab(page, 'fleet'); trusted_click(page, '[data-space="recall"][data-fleet="8"]'); advance(page, 1000)
    whole_state('native-recalled-return', save(page), branch['expected']); record(page, 'native-recall-no-loot'); context.close()
    branch = fixtures['branches']['offline']; begin_case('actual cold startup with controlled ten-second offline gap')
    context, page = boot(branch['now'], initial_raw=branch['baseRaw'])
    whole_state('native-offline-once', save(page), branch['expected']['state']); first = raw(page)
    page.reload(wait_until='networkidle'); advance(page)
    check('same-time second startup leaves original adopted raw unchanged', raw(page) == first)
    whole_state('native-offline-second-startup', save(page), branch['expected']['state']); record(page, 'native-offline-once'); context.close()


def simultaneous_arrivals():
    branch = fixtures['branches']['simultaneous']; begin_case('two genuinely paid attacks with exactly the same arrival')
    context, page = boot(branch['base']['savedAt'], initial_raw=branch['baseRaw'])
    for fleet_id in branch['fleetIds']:
        configure_fleet(page, 'attack', branch['count']); trusted_click(page, '#space-send')
    whole_state('native-simultaneous-paid', save(page), branch['paid'])
    for _ in range(branch['advanceToArrival']):
        advance(page, 1000)
    arrived = save(page); whole_state('native-simultaneous-arrived', arrived, branch['arrived'])
    check('same-arrival actual report order follows stable IDs',
          [r['fleetId'] for r in arrived['npcBattles']['reports'] if r['fleetId'] in branch['fleetIds']] == branch['fleetIds'])
    for _ in range(branch['advanceToReturn']):
        advance(page, 1000)
    whole_state('native-simultaneous-returned', save(page), branch['returned']); record(page, 'native-simultaneous-two-attacks'); context.close()


def exact_confirmation(page, selector, expected, accept, label):
    dialogs = []
    def answer(dialog):
        valid = dialog.type == 'confirm' and dialog.message == expected
        dialogs.append({'type': dialog.type, 'message': dialog.message, 'valid': valid, 'accepted': accept and valid})
        dialog.accept() if accept and valid else dialog.dismiss()
    page.once('dialog', answer)
    trusted_click(page, selector)
    check(label + ': exactly one native confirmation has the complete expected text',
          len(dialogs) == 1 and dialogs[0]['valid'] and dialogs[0]['accepted'] == accept, dialogs)
    evidence.append({'case': case, 'label': label, 'nativeConfirmation': dialogs})


def remainder_reset_boundaries():
    branch = fixtures['branches']['curvature']
    begin_case('genuine earned pending right: native curvature preview, cancel and accepted reset')
    context, page = boot(branch['base']['savedAt'], initial_raw=branch['baseRaw'])
    whole_state('earned-right-curvature-start', save(page), branch['base']['state'])
    tail = planet(branch['base']['state'])['npcResourceRemainder']['crystal']
    check('curvature source has the exact naturally earned tiny right', tail == '0.00000000006')
    for width in (320, 390, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page); tab(page, 'curvature')
        for selector in ('#prestige-preview-details', '#prestige-preview-npc-remainders'):
            summary = selector + ' > summary'; native_scroll_to(page, summary)
            if not page.locator(selector).evaluate('(e)=>e.open'):
                page.locator(summary).focus(); page.locator(summary).press('Enter'); advance(page)
        expected_row = '母星 [homeworld]：金属 0 / 晶体 ' + tail + ' / 重氢 0'
        check('curvature preview exposes exact earned owner/resource without ordinary-wallet rounding',
              page.locator('#prestige-preview-npc-remainder-rows').inner_text() == expected_row)
        snapshot_control(page, '#prestige-preview-npc-remainder-rows', f'native-{width}-curvature-earned-right')
        exact_confirmation(page, '[data-action="prestige"]', branch['confirmation'], False, f'curvature-{width}-cancel')
        whole_state('curvature-cancel-retains-complete-earned-state-' + str(width), save(page), branch['base']['state'])
    tab(page, 'curvature')
    exact_confirmation(page, '[data-action="prestige"]', branch['confirmation'], True, 'curvature-accept')
    actual = save(page); whole_state('curvature-independent-whole-state-reset', actual, branch['expected'])
    check('new home has zero rights and permanent NPC universe is retained',
          all(all(v == '0' for v in world['npcResourceRemainder'].values()) for world in actual['planets'])
          and exact_json(actual['npcEconomy'], branch['base']['state']['npcEconomy']))
    record(page, 'native-earned-right-curvature-accepted'); context.close()

    branch = fixtures['branches']['abandon']
    begin_case('explicit synthetic colony-only quarter-unit right: native abandon cancel and accept')
    check('abandon fixture discloses the sole synthetic edit', branch['syntheticChanges'] ==
          [{'path': 'planets[colony-1].npcResourceRemainder.metal', 'before': '0', 'after': '0.25'}])
    context, page = boot(branch['base']['savedAt'], initial_raw=branch['baseRaw'])
    button = '[data-space="abandon"][data-planet="colony-1"]'
    for width in (320, 390, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page); tab(page, 'fleet')
        selector = '#space-planets [data-world-id="colony-1"] .npc-resource-remainder'
        summary = selector + ' > summary'; native_scroll_to(page, summary)
        if not page.locator(selector).evaluate('(e)=>e.open'):
            page.locator(summary).focus(); page.locator(summary).press('Enter'); advance(page)
        check('synthetic colony right retains exact owner and amount in UI',
              page.locator(selector + ' .npc-remainder-exact').inner_text() == '金属 0.25 · 晶体 0 · 重氢 0')
        snapshot_control(page, selector + ' .npc-remainder-exact', f'native-{width}-synthetic-colony-right')
        exact_confirmation(page, button, branch['confirmation'], False, f'abandon-{width}-cancel')
        whole_state('abandon-cancel-preserves-every-field-' + str(width), save(page), branch['base']['state'])
    tab(page, 'fleet'); exact_confirmation(page, button, branch['confirmation'], True, 'abandon-accept')
    actual = save(page); whole_state('abandon-independent-ownership-removal', actual, branch['expected'])
    check('abandoned right is never transferred to home or NPC',
          exact_json(planet(actual), planet(branch['base']['state']))
          and exact_json(actual['npcEconomy'], branch['base']['state']['npcEconomy'])
          and not any(p['id'] == 'colony-1' for p in actual['planets']))
    record(page, 'native-synthetic-colony-right-abandoned'); context.close()


def blocked_retry_boundary():
    branch = fixtures['branches']['blockedRetry']
    check('blocked dock fixture discloses only synthetic landed ships',
          len(branch['syntheticChanges']) == 1 and branch['syntheticChanges'][0]['path'] == 'planets[homeworld].units.light_fighter'
          and branch['syntheticChanges'][0]['after'] == 10 ** 15)
    for row in branch['moneyWitnesses']:
        target = Fraction(row['beforeWallet']) + Fraction(row['beforeRemainder']) + row['signedInteger']
        check('independent Python exact retry money proof for ' + row['resource'],
              Fraction(row['afterWallet']) + Fraction(row['afterRemainder']) == target
              and 0 <= Fraction(row['afterRemainder']) < 1 and Fraction(row['afterWallet']) <= target)
    for width in (320, 390, 768, 1440):
        begin_case('explicit synthetic landed limit: actual failed and successful native dock retry at width ' + str(width))
        context, page = boot(branch['base']['savedAt'], width=width, initial_raw=branch['baseRaw'])
        for _ in range(branch['advanceToBlocked']):
            advance(page, 1000)
        whole_state('actual-blocked-arrival-' + str(width), save(page), branch['blocked'])
        tab(page, 'messages')
        blocked_receipt = next(receipt for receipt in branch['blocked']['npcBattles']['reports'] if receipt['fleetId'] == 8)
        inspect_closed_report(page, '#npc-battle-reports details[data-npc-report="8"]', blocked_receipt,
                              branch['blocked'], 'native-blocked-retry', widths=(width,))
        tab(page, 'fleet'); button = '[data-space="npc-retry-dock"][data-fleet="8"]'
        expect(page.locator(button)).to_be_enabled()
        snapshot_control(page, button, f'native-{width}-blocked-dock-retry')
        trusted_click(page, button)
        expect(page.locator('[data-bind="status"]')).to_have_text(branch['refusal'])
        whole_state('failed-retry-keeps-ship-cargo-right-report-once-' + str(width), save(page), branch['blocked'])
        configure_fleet(page, 'attack', branch['releaseCount']); trusted_click(page, '#space-send')
        released = save(page); whole_state('genuine-paid-capacity-release-' + str(width), released, branch['released'])
        tab(page, 'fleet'); old_button = page.locator(button).element_handle()
        snapshot_control(page, button, f'native-{width}-released-capacity-retry')
        trusted_click(page, button); actual = save(page)
        whole_state('successful-native-retry-exact-once-' + str(width), actual, branch['expected'])
        for row in branch['moneyWitnesses']:
            resource = row['resource']; before, after = planet(released), planet(actual)
            check('native actual retry exact entitlement ' + resource,
                  Fraction(before['resources'][resource]) + Fraction(before['npcResourceRemainder'][resource]) + row['signedInteger'] ==
                  Fraction(after['resources'][resource]) + Fraction(after['npcResourceRemainder'][resource]))
        tab(page, 'fleet'); expect(page.locator(button)).to_have_count(0)
        old_button.evaluate('(element)=>element.click()'); advance(page)
        whole_state('retired-retry-node-cannot-credit-twice-' + str(width), save(page), branch['expected'])
        record(page, 'native-' + str(width) + '-synthetic-blocked-release-and-retry'); context.close()


def report_identity_boundary():
    branch = fixtures['branches']['reportIdentity']
    natural = fixtures['naturalMilestones']['empty10-zero-round-loot-delivered']
    wanted = copy.deepcopy(natural['save']['state'])
    colony = planet(wanted, COLONY)
    changes = [{'path': 'planets[colony-1].name', 'before': colony['name'],
                'after': '远航殖民地 <星光 & 北岸> 测试'},
               {'path': 'npcBattles.reports[8].originId', 'before': HOME, 'after': COLONY}]
    check('report identity fixture explicitly discloses only the two independent synthetic UI edits',
          branch['reportId'] == 8 and exact_json(branch['syntheticChanges'], changes))
    colony['name'] = changes[0]['after']
    receipt = next(row for row in wanted['npcBattles']['reports'] if row['fleetId'] == 8)
    check('synthetic identity fixture starts with a genuinely terminal homeworld report',
          receipt['originId'] == HOME and receipt['delivery'] == 'delivered')
    receipt['originId'] = COLONY
    whole_state('independent-explicit-report-identity-input', branch['base']['state'], wanted)
    missing = copy.deepcopy(wanted)
    missing['planets'] = [world for world in missing['planets'] if world['id'] != COLONY]
    missing['deepSpace']['offers'] = [offer for offer in missing['deepSpace']['offers'] if offer['planetId'] != COLONY]
    whole_state('independent-report-identity-abandonment-output', branch['expected'], missing)
    begin_case('explicit synthetic report source identity import then lawful native abandonment')
    context, page = boot(natural['save']['savedAt'], initial_raw=natural['raw'])
    import_save(page, branch['base'], 'synthetic-report-identity', original_raw=branch['baseRaw'])
    inspect_reports(page, wanted, 'synthetic-current-report-origin', four_widths=True, report_ids={8})
    tab(page, 'fleet')
    exact_confirmation(page, '[data-space="abandon"][data-planet="colony-1"]',
                       branch['confirmation'], True, 'report-identity-abandon-accept')
    actual = save(page)
    whole_state('native-abandon-removes-only-identity-colony-and-offers', actual, missing)
    check('native missing-source transition retains the exact complete immutable receipt collection',
          exact_json(actual['npcBattles'], wanted['npcBattles']))
    inspect_reports(page, missing, 'synthetic-missing-report-origin', four_widths=True, report_ids={8})
    record(page, 'native-synthetic-report-identity-abandoned'); context.close()


def verify_compact_report_coverage():
    captures = [row for row in evidence if row.get('kind') == 'compact-closed-summary']
    for fleet_id, outcome in ((7, '平'), (8, '胜'), (10, '无驻军收集')):
        for delivery in ('战后返航', '已入港'):
            for width in (320, 390, 768, 1440):
                check('natural closed compact matrix covers exact receipt outcome/delivery/width',
                      any(row['fleetId'] == fleet_id and row['width'] == width
                          and row['label'].startswith('native-') and row['label'] != 'native-blocked-retry'
                          and row['expected']['outcome'] == outcome and row['expected']['delivery'] == delivery
                          for row in captures), {'fleetId': fleet_id, 'outcome': outcome, 'delivery': delivery, 'width': width})
    for label, delivery in (('native-blocked-retry', '入港受阻'),
                            ('synthetic-current-report-origin', '已入港'), ('synthetic-missing-report-origin', '已入港')):
        for width in (320, 390, 768, 1440):
            check('separate closed compact boundaries retain four-width evidence',
                  any(row['label'] == label and row['fleetId'] == 8 and row['width'] == width
                      and row['expected']['delivery'] == delivery for row in captures), {'label': label, 'width': width})
    for row in captures:
        image = (out / row['file']).read_bytes()
        check('each compact capture references its actual exact content-addressed screenshot bytes',
              len(image) == row['byteLength'] and hashlib.sha256(image).hexdigest() == row['sha256']
              and row['file'] == 'native-closed-' + row['sha256'] + '.png', row)


def old_node_witnesses():
    row = fixtures['naturalMilestones']['first-three-fighters-complete']
    for probe in ('hidden-tab', 'remove-reinsert', 'clone', 'same-world-import'):
        begin_case('explicit DOM authority probe: ' + probe)
        context, page = boot(row['save']['savedAt'], initial_raw=row['raw']); configure_fleet(page, 'attack', 4)
        button = page.locator('#space-send').element_handle()
        if probe == 'hidden-tab':
            tab(page, 'messages'); button.evaluate('(e)=>e.click()')
        elif probe == 'remove-reinsert':
            button.evaluate('(e)=>{const p=e.parentElement,n=e.nextSibling;e.remove();p.insertBefore(e,n);e.click();}')
        elif probe == 'clone':
            button.evaluate('(e)=>{const clone=e.cloneNode(true);e.replaceWith(clone);clone.click();}')
        else:
            import_save(page, row['save'], 'same-seed-same-ids-world-replacement', original_raw=row['raw'])
            tab(page, 'fleet')
            check('same-world stale probe runs in the visible fleet panel without re-editing the retired draft',
                  page.locator('#space-fleet').is_visible())
            button.evaluate('(e)=>e.click()')
        advance(page); whole_state('retired-authority-' + probe, save(page), row['save']['state'])
        record(page, 'native-retired-authority-' + probe); context.close()


def storage_faults():
    row = fixtures['naturalMilestones']['attack7-paid-outbound']
    for fault in ({'target': 'current', 'operation': 'write', 'mode': 'throw'},
                  {'target': 'current', 'operation': 'write', 'mode': 'drop'},
                  {'target': 'current', 'operation': 'readback'}):
        begin_case('explicit native attack storage fault: ' + json.dumps(fault, sort_keys=True))
        context, page = boot(row['save']['savedAt'], initial_raw=row['raw'], fault=fault)
        advance(page, 1000); tab(page, 'save')
        if page.locator('[data-action="save"]').is_enabled():
            trusted_click(page, '[data-action="save"]')
        expect(page.locator('[data-bind="notice"]')).to_be_visible()
        audit = page.evaluate('window.__npcFaultAudit'); check('fault branch actually reached declared Storage wrapper', any(x['kind'].startswith(('write-', 'readback-')) for x in audit), audit)
        disk_after_fault = storage(page); tab(page, 'fleet')
        for _ in range(3):
            advance(page, 1000)
        check('save protection disables attack recall authority', page.locator('[data-space="recall"][data-fleet="7"]').is_disabled())
        tab(page, 'save'); export_protected(page, row['raw'], 'native-protected-' + fault['operation'] + '-' + fault.get('mode', 'throw') + '.json')
        check('fault branch retains original cached complete attack envelope', json.loads(row['raw'])['state']['fleets'][0]['id'] == 7)
        check('readback uncertainty is reported without claiming unchanged disk', fault['operation'] != 'readback' or any(x['kind'] == 'readback-throw' for x in audit))
        label = fault['operation'] + '-' + fault.get('mode', 'throw')
        atomic_json(out / ('native-storage-fault-audit-' + label + '.json'), {'fault': fault, 'audit': audit, 'storageAfterUncertainTransaction': disk_after_fault, 'classification': 'Explicit native Storage wrapper fault. Successful write followed by throwing readback may have changed disk; no unchanged-disk claim.'})
        record(page, 'native-fault-' + label); context.close()


def migration_backup_faults():
    for fault in ({'target': 'backup', 'operation': 'write', 'mode': 'throw'}, {'target': 'backup', 'operation': 'readback'}):
        begin_case('explicit native backup fault during exact r12 migration: ' + fault['operation'])
        context, page = boot(fixtures['originalSave']['savedAt'], initial_raw=fixtures['originalSaveRaw'], fault=fault)
        expect(page.locator('[data-bind="notice"]')).to_contain_text('原件已保留并受保护')
        tab(page, 'overview'); played = page.locator('[data-bind="played"]').inner_text(); baseline = storage(page)
        advance(page, 1000); advance(page, 1000)
        check('migration backup failure freezes visible progress and all stored bytes', page.locator('[data-bind="played"]').inner_text() == played and storage(page) == baseline)
        tab(page, 'save'); export_protected(page, fixtures['originalSaveRaw'], 'native-migration-original-' + fault['operation'] + '.json')
        audit = page.evaluate('window.__npcFaultAudit')
        check('declared backup fault actually reached native wrapper', any(x['kind'] == ('readback-throw' if fault['operation'] == 'readback' else 'write-throw') for x in audit), audit)
        context.close()


def cross_tab():
    row = fixtures['naturalMilestones']['attack7-paid-outbound']; competing = fixtures['naturalMilestones']['attack8-paid-outbound']
    begin_case('actual native cross-tab storage event retires attack controls')
    context, page = boot(row['save']['savedAt'], initial_raw=row['raw']); tab(page, 'fleet')
    old_recall = page.locator('[data-space="recall"][data-fleet="7"]').element_handle()
    writer = context.new_page(); writer.goto(urljoin(args.url, 'icons/save.webp'), wait_until='load')
    writer.evaluate('({key,value})=>localStorage.setItem(key,value)', {'key': KEY, 'value': competing['raw']})
    page.bring_to_front(); expect(page.locator('[data-bind="notice"]')).to_contain_text('其他标签页')
    check('real trusted storage event delivered exact competing bytes', any(x['trusted'] and x['newValue'] == competing['raw'] for x in page.evaluate('window.__npcStorage')))
    old_recall.evaluate('(e)=>e.click()'); advance(page, 1000)
    check('cross-tab protection does not overwrite competing attack world', raw(page) == competing['raw'])
    tab(page, 'save'); export_protected(page, row['raw'], 'native-cross-tab-original-attack.json'); context.close()


try:
    source_bytes = Path(args.natural_report).read_bytes(); source_report = json.loads(source_bytes)
    check('complete natural report independently pinned by fixture and CLI', hashlib.sha256(source_bytes).hexdigest() == args.expected_report_sha256 == fixture_sha256)
    check('passing exact candidate natural report with clean source required',
          source_report['schema'] == 'infinity-npc-attack-natural-route-v2' and source_report['outcome']['status'] == 'passed'
          and source_report['source']['sourceSha'] == source_report['source']['gitHead'] == args.expected_sha
          and source_report['source']['sourceScopeStatusPorcelain'] == '')
    check('native oracle declares and proves the exact four-reload schedule', native_reload_schedule_valid(source_report))
    check('original public r12 final raw remains byte-exact', hashlib.sha256(fixtures['originalSaveRaw'].encode()).hexdigest() == '047d49cbf04fd5424bca4d7d45e861e0439a0d51c4ac54700f77e263bb8eadcc'
          and fixtures['originalSave']['revision'] == 12 and fixtures['base']['revision'] == 14
          and fixtures['provenance']['injectedGameState'] is False)
    for row in fixtures['milestones']:
        check('milestone raw bytes and full envelope are bound: ' + row['name'],
              hashlib.sha256(row['raw'].encode()).hexdigest() == row['rawSha256'] and exact_json(json.loads(row['raw']), row['save']))
    verify_exact_money_witnesses()
    (out / 'source-npc-attack-natural-report.json').write_bytes(source_bytes)
    with sync_playwright() as playwright, capture_live_failure():
        browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        begin_case('native exact public r12 import then full actual paid scout/build/battle/loot/return loop')
        context, page = boot(fixtures['originalSave']['savedAt'])
        import_save(page, fixtures['originalSave'], 'public-eef-r12-final66', original_raw=fixtures['originalSaveRaw'], expected=fixtures['importedSave'])
        native_tape(page); record(page, 'native-final-full-loop'); context.close()
        same_time_boundaries(); recall_and_offline(); simultaneous_arrivals(); remainder_reset_boundaries(); blocked_retry_boundary(); report_identity_boundary(); old_node_witnesses(); storage_faults(); migration_backup_faults(); cross_tab()
        begin_case('suite integrity')
        verify_compact_report_coverage()
        check('no actual app errors or failed production requests', not errors and not failed_requests, {'errors': errors, 'failedRequests': failed_requests})
        check('served release exact v9/r14', release_metadata['saveVersion'] == 9 and release_metadata['saveRevision'] == 14)
        completed = True; browser.close(); flush(full=True, final=True)
except BaseException as error:
    if failure is None:
        capture_failure(error)
    raise
finally:
    signal.alarm(0)
    os.close(journal.fd)
