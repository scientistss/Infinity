"""SaveSession acceptance against an HTTP production build and native localStorage.

No inline/Map-Storage fallback is provided. Storage.prototype wrappers observe real
calls; only explicitly labeled fault cases suppress/throw writes. Async race cases
gate a real File.text() result. These are not claims of naturally occurring quota
exhaustion or timing races. Run after generating save-session-review-save.json.
"""
import argparse
from r12_compatibility import CURRENT_REVISION, npc_elapsed_from_segments, lift_r11_state_to_r12, lift_r10_state_to_r12, assert_zero_grant_metadata, exact_json, lift_legacy_state_to_r12, project_verified_r12_metadata
import copy
import hashlib
import json
import re
import shutil
import subprocess
import time
import traceback
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse, urljoin

from native_frame_trace import prepare_plan, NativeFrameTrace, to_replay_epoch, through_manual_save
from playwright.sync_api import expect, sync_playwright


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:4173/Infinity/")
parser.add_argument("--fixture", default="save-session-review-save.json")
parser.add_argument("--output", default="save-session-evidence")
parser.add_argument("--chromium", default=None)
parser.add_argument("--expected-sha", required=True, help="Exact tested release commit for native HTTP/V8 trace identity")
parser.add_argument("--r10-source", required=True, help="Exact clean ac3 r10 source for independent native startup catch-up expectations")
parser.add_argument("--r11-source", required=True, help="Exact clean ca5 r11 source for independent adopted-segment startup expectations")
args = parser.parse_args()
fixtures = json.loads(Path(args.fixture).read_text())
KEY, BACKUP = fixtures["key"], fixtures["backupKey"]
SAVE_REVISION = fixtures["saveRevision"]
assert SAVE_REVISION == CURRENT_REVISION, "Current browser contract requires native r12"
LEGACY = "infinity.save.v1"
LEGACY_RAW = "SYNTHETIC LEGACY BYTES: must remain untouched"
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
checks, errors, failed_requests, audit_reports = [], [], [], []
completed = False
case = "setup"
classification = "HTTP / native localStorage"
browser = None
active_page = None
failure = None
native_release_metadata = None
active_native_trace = None


def check(name, condition):
    checks.append({"case": case, "name": name, "passed": bool(condition),
                   "classification": classification})
    if not condition:
        raise AssertionError(f"{case}: {name}")


def confirmation_count(page):
    return page.evaluate('window.__fileImportConfirmations.length')


def raw_fixture(which="current"):
    value = copy.deepcopy(fixtures[which])
    value["savedAt"] = value["lastTickAt"] = int(time.time() * 1000)
    return json.dumps(value, ensure_ascii=False, indent=2)


def legacy_fixture(revision):
    source = next((entry for entry in fixtures["legacySources"] if entry["revision"] == revision), None)
    if not source or source["generatedBy"] != "actual source-revision createInitialState/exportSave":
        raise RuntimeError(f"r{revision} source-generated fixture is required")
    value = copy.deepcopy(fixtures["legacy"][str(revision)])
    if value["revision"] != revision:
        raise RuntimeError("source fixture revision mismatch")
    value["savedAt"] = value["lastTickAt"] = int(time.time() * 1000)
    return json.dumps(value, ensure_ascii=False, indent=2)


def name_of(raw):
    return json.loads(raw)["state"]["planets"][0]["name"]


def raw(page, key=KEY):
    return page.evaluate("key => localStorage.getItem(key)", key)


def planet(page):
    return page.locator('[data-bind="ov-planet"]').text_content()


def clear_audit(page):
    page.evaluate("window.__saveAudit.length = 0")


def events(page):
    return page.evaluate("window.__saveAudit")


def capture_audit(page, label):
    # Keep evidence concise and avoid storing several copies of every large save.
    rows = events(page)
    for row in rows:
        for field in ("value", "current"):
            value = row.get(field)
            if isinstance(value, str):
                row[field + "Sha256"] = hashlib.sha256(value.encode()).hexdigest()
                row[field + "Bytes"] = len(value.encode())
                del row[field]
    audit_reports.append({"case": case, "label": label,
                          "classification": classification, "events": rows})


def migration_differences(expected, actual, path="$state"):
    """Diagnostic only: retain every mismatch; never normalize a comparison."""
    if type(expected) is not type(actual):
        return [{"path": path, "expected": expected, "actual": actual}]
    if isinstance(expected, dict):
        differences = []
        for key in sorted(expected.keys() | actual.keys()):
            if key not in expected or key not in actual:
                differences.append({"path": path + "." + key, "expected": expected.get(key), "actual": actual.get(key),
                                    "expectedPresent": key in expected, "actualPresent": key in actual})
            else:
                differences.extend(migration_differences(expected[key], actual[key], path + "." + key))
        return differences
    if isinstance(expected, list):
        if len(expected) != len(actual):
            return [{"path": path, "expected": expected, "actual": actual}]
        return [difference for index, (left, right) in enumerate(zip(expected, actual))
                for difference in migration_differences(left, right, f"{path}[{index}]")]
    return [] if expected == actual else [{"path": path, "expected": expected, "actual": actual}]


def capture_startup_migration(page, original, revision):
    # Persist complete evidence while Playwright is still alive and BEFORE any
    # equality assertion. Hash-only audit summaries cannot diagnose state drift.
    current, backup = raw(page), raw(page, BACKUP)
    rows = events(page)
    first = next((row["value"] for row in rows if row["operation"] == "write-return" and row["key"] == KEY), None)
    prefix = f"r{revision}-startup"
    artifacts = {}
    for label, value in (("original", original), ("first-current", first), ("current", current), ("backup", backup)):
        if value is None:
            artifacts[label] = {"missing": True}
            continue
        path = out / f"{prefix}-{label}.json"
        data = value.encode("utf-8"); path.write_bytes(data)
        artifacts[label] = {"file": path.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    audit_path = out / f"{prefix}-complete-audit.json"
    audit_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    diagnostic = {"classification": "Unmodified native startup clock; complete captured bytes, not a reconstructed prior failure",
                  "case": case, "artifacts": artifacts, "auditFile": audit_path.name,
                  "firstCommitEqualsCurrent": first == current, "originalEqualsBackup": original == backup,
                  "assertionPolicy": "The strict full-state and exact-backup assertions remain unchanged; no drift is allowed by this diagnostic."}
    if first is not None:
        source, committed = json.loads(original), json.loads(first)
        diagnostic["clock"] = {"sourceSavedAt": source["savedAt"], "sourceLastTickAt": source["lastTickAt"],
                               "firstSavedAt": committed["savedAt"], "firstLastTickAt": committed["lastTickAt"],
                               "constructorGapMilliseconds": committed["savedAt"] - source["lastTickAt"]}
        if revision == 10:
            diagnostic["fullStateDifferencesFromZeroAgeNullSlotLift"] = migration_differences(lift_r10_state_to_r12(source["state"]), committed["state"])
    (out / f"{prefix}-diagnostic.json").write_text(json.dumps(diagnostic, ensure_ascii=False, indent=2), encoding="utf-8")


def capture_reload_evidence(page, label, original, committed, *, phase, observer=None):
    """Read-only complete evidence, before the strict native trajectory assertions."""
    prefix = f'r9-{label}-reload-{phase}'
    host_before = time.time_ns()
    snapshot = page.evaluate('''() => ({
      wallAt: Date.now(), performanceAt: performance.now(),
      current: window.__saveNativeRead(__KEY__), backup: window.__saveNativeRead(__BACKUP__),
      audit: window.__saveAudit
    })'''.replace('__KEY__', json.dumps(KEY)).replace('__BACKUP__', json.dumps(BACKUP)))
    host_after = time.time_ns()
    artifacts = {}
    for name, value in (('original',original),('migration-committed',committed),
                        ('current',snapshot['current']),('backup',snapshot['backup'])):
        if value is None:
            artifacts[name] = {'missing':True}; continue
        data = value.encode('utf-8'); path = out / f'{prefix}-{name}.json'; path.write_bytes(data)
        artifacts[name] = {'file':path.name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    rows = snapshot['audit']
    audit_file = out / f'{prefix}-complete-audit.json'
    audit_file.write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    first_read = next((row for row in rows if row['operation']=='read' and row.get('key')==KEY),None)
    first_write = next((row for row in rows if row['operation']=='write-return' and row.get('key')==KEY),None)
    cdp_rows = [] if observer is None else copy.deepcopy(observer['events'])
    cdp_file = out / f'{prefix}-native-storage-events.json'
    cdp_file.write_text(json.dumps(cdp_rows,ensure_ascii=False,indent=2),encoding='utf-8')
    diagnostic = {'case':case,'phase':phase,'classification':'Read-only native reload observation; no clock, storage or game-state replacement',
        'hostObservationBeforeNanoseconds':host_before,'hostObservationAfterNanoseconds':host_after,
        'browserWallAt':snapshot['wallAt'],'browserPerformanceAt':snapshot['performanceAt'],
        'artifacts':artifacts,'completeAuditFile':audit_file.name,'nativeStorageEventsFile':cdp_file.name,
        'firstCurrentRead':first_read,'firstCurrentWriteReturn':first_write,
        'firstCrossDocumentCurrentUpdate':next((row for row in cdp_rows if row['event'].get('key')==KEY),None),
        'backupEqualsOriginal':snapshot['backup']==original,'currentEqualsMigrationCommit':snapshot['current']==committed,
        'assertionPolicy':'First migration remains exact; ordinary reload is checked by the independently replayed full native trajectory.'}
    if snapshot['current'] is not None:
        current = json.loads(snapshot['current']); before = json.loads(committed)
        diagnostic['completeEnvelopeDifferencesFromMigrationCommit'] = migration_differences(before,current,'$save')
        diagnostic['currentEnvelopeClocks'] = {key:current.get(key) for key in ('revision','savedAt','lastTickAt')}
    (out / f'{prefix}-diagnostic.json').write_text(json.dumps(diagnostic,ensure_ascii=False,indent=2),encoding='utf-8')
    return diagnostic


def observe_reload_storage(page):
    """CDP observes real updates across old-document unload and new-document startup."""
    observer = {'events':[]}
    cdp = page.context.new_cdp_session(page)
    def record(name, event):
        if not event.get('storageId',{}).get('isLocalStorage'):
            return
        key = event.get('key')
        if key is not None and key != KEY and not key.startswith(BACKUP):
            return
        observer['events'].append({'eventName':name,'hostReceivedNanoseconds':time.time_ns(),'event':copy.deepcopy(event)})
    for name in ('domStorageItemAdded','domStorageItemUpdated','domStorageItemRemoved','domStorageItemsCleared'):
        cdp.on('DOMStorage.'+name,lambda event,name=name:record(name,event))
    cdp.send('DOMStorage.enable')
    observer['session'] = cdp
    return observer


def prepare_r9_trace_plan(playwright):
    """Preverify real HTTP bytes; no navigation, source replacement or clock hook."""
    global native_release_metadata
    request = playwright.request.new_context()
    try:
        release_url = urljoin(args.url, 'release.json')
        response = request.get(release_url, timeout=15000)
        check('native replay release is exact HTTP 200 without redirect', response.status == 200 and response.url == release_url)
        release = response.json()
        check('native replay release pins the mandatory exact candidate commit and current schema',
              re.fullmatch(r'[0-9a-f]{40}', args.expected_sha) is not None
              and release.get('sourceSha') == args.expected_sha
              and release.get('saveRevision') == CURRENT_REVISION and release.get('saveVersion') == 9)
        files = release['files']
        script_files = [name for name in files if name.endswith('.js')]
        check('native replay release contains exactly one production JavaScript asset', len(script_files) == 1)
        asset = script_files[0]; asset_url = urljoin(args.url, asset)
        check('native replay asset stays in the exact tested HTTP directory', asset_url.startswith(args.url) and '..' not in asset.split('/'))
        html = request.get(args.url, timeout=15000)
        check('prefetched complete HTTP document matches pinned release bytes', html.status == 200 and html.url == args.url
              and hashlib.sha256(html.body()).hexdigest() == files['index.html'])
        script = request.get(asset_url, timeout=15000)
        check('prefetched production asset is exact HTTP 200 without redirect', script.status == 200 and script.url == asset_url)
        plan = prepare_plan(asset_url, script.body(), files[asset])
        native_release_metadata = release
        (out / 'r9-native-release.json').write_bytes(response.body())
        (out / 'r9-native-http-index.html').write_bytes(html.body())
        (out / 'r9-native-http-production.js').write_bytes(script.body())
        return plan
    finally:
        request.dispose()


def start_r9_native_trace(page, plan):
    cdp = page.context.new_cdp_session(page)
    trace = NativeFrameTrace(cdp, plan)
    capture = {'captureCase':case,'createdHostNanoseconds':time.time_ns(),'trace':trace,'responses':[],'allResponses':[],'requests':[],
               'requestFailures':[],'pageErrors':[],'navigations':[],'networkEvents':[],
               'storage':observe_reload_storage(page),
               'preparation':{'scope':'r9 correctness only; not a performance measurement',
                    'networkCacheDisabled':True,'installedBeforeGoto':True,
                    'priorFailureCause':'025 navigation failure lacked status/count/redirect evidence; no cache cause is inferred'}}
    def response_received(response):
        capture['allResponses'].append(response)
        if response.request.resource_type=='document':
            capture['lastDocumentResponse'] = response
        if response.request.resource_type=='script':
            capture['responses'].append(response)
    for event_name in ('requestWillBeSent','responseReceived','requestServedFromCache','loadingFailed'):
        cdp.on('Network.'+event_name,lambda event,event_name=event_name:capture['networkEvents'].append({'eventName':event_name,'event':copy.deepcopy(event)}))
    page.on('response',response_received)
    page.on('request',lambda request:capture['requests'].append(request))
    page.on('requestfailed',lambda request:capture['requestFailures'].append(request))
    page.on('pageerror',lambda error:capture['pageErrors'].append(str(error)))
    # Explicit fresh network preparation for this correctness trace, not a clock,
    # storage, request route or production source replacement.
    cdp.send('Network.enable')
    cdp.send('Network.setCacheDisabled',{'cacheDisabled':True})
    trace.install()
    return capture


def capture_r9_navigation_evidence(capture, response, *, scripts=None, suffix='before-assertion'):
    """Preserve raw HTTP facts before checking them; diagnostics never repair IO."""
    number = len(capture['navigations'])+1
    capture_case = capture.get('captureCase',case)
    prefix = f"r9-native-{hashlib.sha256(capture_case.encode()).hexdigest()[:12]}-navigation-{number}-{suffix}"
    report = {'case':capture_case,'currentCase':case,'belongsToCurrentCase':capture_case==case,
              'createdHostNanoseconds':capture.get('createdHostNanoseconds'),
              'navigation':number,'preparation':capture.get('preparation'),
              'priorVerifiedNavigations':copy.deepcopy(capture['navigations']),
              'networkEvents':copy.deepcopy(capture.get('networkEvents',[])),
              'captureErrors':[],'pageErrors':list(capture.get('pageErrors',[]))}
    def attempt(label, operation):
        try:
            return operation()
        except Exception as error:
            report['captureErrors'].append({'part':label,'error':repr(error)})
            return None
    def request_metadata(request, label):
        row = {}
        for field in ('url','method','resource_type','headers','failure','timing'):
            row[field] = attempt(label+'.'+field,lambda field=field:getattr(request,field))
        return row
    def response_metadata(item, label, *, body=False):
        if item is None:
            return {'missing':True}
        row = {}
        for field in ('status','status_text','url','headers','from_service_worker'):
            row[field] = attempt(label+'.'+field,lambda field=field:getattr(item,field))
        request = attempt(label+'.request',lambda:item.request)
        if request is not None:
            row['request'] = request_metadata(request,label+'.request')
            chain, previous, seen = [], attempt(label+'.redirected_from',lambda:request.redirected_from), set()
            while previous is not None and id(previous) not in seen:
                seen.add(id(previous)); link = request_metadata(previous,label+'.redirect')
                prior_response = attempt(label+'.redirect.response',previous.response)
                if prior_response is not None:
                    link['responseStatus'] = attempt(label+'.redirect.status',lambda:prior_response.status)
                    link['responseURL'] = attempt(label+'.redirect.url',lambda:prior_response.url)
                chain.append(link)
                previous = attempt(label+'.redirect.parent',lambda:previous.redirected_from)
            row['redirectChain'] = list(reversed(chain))
        if body:
            data = attempt(label+'.body',item.body)
            if data is not None:
                path = out / f'{prefix}-{label}.body'
                attempt(label+'.write',lambda:path.write_bytes(data))
                row['body'] = {'file':path.name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        return row
    report['documentResponse'] = response_metadata(response,'document')
    script_rows = list(capture['responses']) if scripts is None else scripts
    report['scriptResponseCount'] = len(script_rows)
    report['scriptResponses'] = [response_metadata(item,f'script-{index}') for index,item in enumerate(script_rows)]
    report['pinnedScriptURL'] = capture['trace'].plan.url
    report['matchingScriptResponseCount'] = sum(row.get('url')==capture['trace'].plan.url for row in report['scriptResponses'])
    report['matchingCdpResponseCount'] = sum(row['eventName']=='responseReceived' and row['event'].get('response',{}).get('url')==capture['trace'].plan.url for row in report['networkEvents'])
    report['allResponses'] = [response_metadata(item,f'response-{index}') for index,item in enumerate(list(capture.get('allResponses',[])))]
    report['allRequests'] = [request_metadata(item,f'request-{index}') for index,item in enumerate(list(capture.get('requests',[])))]
    report['failedRequests'] = [request_metadata(item,f'failed-request-{index}') for index,item in enumerate(list(capture.get('requestFailures',[])))]
    report['capturePhase'] = 'HTTP metadata persisted before body or V8 reads'
    report_path = out / f'{prefix}.json'
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    for label,item,row in [('document',response,report['documentResponse']),*[
            (f'script-{index}',item,report['scriptResponses'][index]) for index,item in enumerate(script_rows)]]:
        if item is None:
            continue
        data = attempt(label+'.body',item.body)
        if data is not None:
            path = out / f'{prefix}-{label}.body'
            attempt(label+'.write',lambda:path.write_bytes(data))
            row['body'] = {'file':path.name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    report['v8Trace'] = attempt('v8Trace',capture['trace'].snapshot)
    report['parsedScripts'] = copy.deepcopy(getattr(capture['trace'],'scripts',[]))
    report['resolvedProbes'] = copy.deepcopy(getattr(capture['trace'],'resolutions',[]))
    report['capturePhase'] = 'Complete HTTP metadata, body attempts and V8 snapshot'
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report




def verify_r9_trace_navigation(capture, response):
    capture['lastDocumentResponse'] = response
    scripts = list(capture['responses'])
    capture_r9_navigation_evidence(capture,response,scripts=scripts)
    check('actual native replay document matches exact pinned HTTP index bytes',
          response is not None and response.status == 200 and response.url == args.url
          and hashlib.sha256(response.body()).hexdigest() == native_release_metadata['files']['index.html'])
    check('actual navigation loads exactly the single pinned production script', len(scripts) == 1
          and scripts[0].status == 200 and scripts[0].url == scripts[0].request.url == capture['trace'].plan.url)
    verified = capture['trace'].verify_executed(scripts[0].body())
    capture['navigations'].append({'documentUrl':response.url,
        'documentSha256':hashlib.sha256(response.body()).hexdigest(),
        'scriptUrl':scripts[0].url,'scriptSha256':hashlib.sha256(scripts[0].body()).hexdigest(),
        'executedScripts':verified})
    capture['responses'] = []
    capture['allResponses'] = []
    capture['requests'] = []
    capture['requestFailures'] = []
    capture['pageErrors'] = []
    capture['networkEvents'] = []


def verify_r9_replay_result(original, request, result):
    """Validate independent result identity and every saved full-envelope target."""
    check('native replay result is from the exact independent ca5 source and original r9 bytes',
          result.get('schema') == 'infinity-fixed-r11-native-replay-oracle-v1'
          and result.get('sourceSha') == 'ca5ef0c769856f2c4c8925e76a5c7d322822fe1b'
          and result.get('inputRawSha256') == hashlib.sha256(original.encode('utf-8')).hexdigest()
          and result.get('sourceRevision') == 9
          and result.get('oldObservedAndUnobservedStateEqual') is True)
    expected_dependencies = {
        'breakInfinity': {'version':'2.2.0','commonSha256':'f3be0918a5ed463a887e5b622574de81dd035c393021af7db9485f34400bda06','esmSha256':'1e1825ab4fa711c16fc7225790d0163cf6b5f5611ab77b39cbb2cd381cb8f71a'},
        'padEnd': {'version':'1.0.2','entrySha256':'063c31f8b5eeb14835a8a358b0dc0099528a5b4719b25057db9e48c752f9c330'}}
    check('native replay uses exactly the pinned predecessor numerical dependencies', exact_json(result.get('dependencyIdentity'),expected_dependencies))
    epochs = request['epochs']
    check('native replay covers both complete captured document epochs', len(epochs) == len(result['epochs']) == 2)
    checkpoints = [(0,-1,'migration',epochs[0]['migrationRaw'])]
    for epoch_index, epoch in enumerate(epochs):
        checkpoints.extend((epoch_index,index,event['reason'],event['raw'])
                           for index,event in enumerate(epoch['events']) if event['kind']=='save')
    check('native replay verifies every observed durable save without omission', len(checkpoints) == len(result['saves']))
    for (epoch_index,event_index,reason,raw_value), saved in zip(checkpoints,result['saves']):
        check('every original full saved envelope equals independent ca5 economic replay and exact cumulative NPC age',
              saved['epochIndex'] == epoch_index and saved['eventIndex'] == event_index and saved['reason'] == reason
              and saved['rawSha256'] == hashlib.sha256(raw_value.encode('utf-8')).hexdigest()
              and exact_json(json.loads(raw_value),saved['expectedEnvelope'])
              and exact_json(saved['expectedEnvelope']['state']['npcEconomy'],
                  {'model':'fixed-production-v1','elapsedSeconds':saved['npcElapsedSeconds']}))
    adoption_inputs = []
    for epoch_index, epoch in enumerate(epochs):
        adoption_inputs.append((epoch_index,-1,'catchUp',(epoch['constructorNow']-json.loads(epoch['sourceRaw'])['lastTickAt'])/1000))
        adoption_inputs.extend((epoch_index,index,'catchUp' if event['gapSeconds']>=5 else 'tick',event['gapSeconds'])
                               for index,event in enumerate(epoch['events']) if event['kind']=='frame' and event['gapSeconds']>0)
    check('every actual startup and positive native frame has exactly one old-engine adoption',len(adoption_inputs)==len(result['adoptions']))
    age, previous_epoch = 0, 0
    for expected_adoption, adoption in zip(adoption_inputs,result['adoptions']):
        epoch_index,event_index,kind,gap = expected_adoption
        check('old-engine adoption preserves every actual native call boundary and exact input',
              (adoption['epochIndex'],adoption['eventIndex'],adoption['kind'],adoption['gapSeconds']) == expected_adoption)
        if epoch_index != previous_epoch:
            age = next(saved['npcElapsedSeconds'] for saved in reversed(result['saves']) if saved['epochIndex']==previous_epoch)
            previous_epoch = epoch_index
        check('each old-engine adoption retains full observed/unobserved state equivalence and the preceding exact age',
              adoption['oldObservedAndUnobservedStateEqual'] is True and adoption['ageBefore'] == age)
        age = npc_elapsed_from_segments([age,*adoption['adoptedSegmentsSeconds']])
        check('ordered actual adopted steps alone determine cumulative NPC age', adoption['npcElapsedSeconds'] == age)
    check('final cumulative NPC age is never reset at current-revision reload', result['npcElapsedSeconds'] == age
          and result['epochs'][-1]['npcElapsedSeconds'] == age)
    check('C is the exact normal manual save checkpoint, never a later autosave', checkpoints[-1][2] == 'manual'
          and result['saves'][-1]['npcElapsedSeconds'] == age
          and exact_json(result['saves'][-1]['expectedEnvelope']['state'],
                         lift_r11_state_to_r12(result['state'],npc_elapsed=age)))
    return result


def verify_r9_native_storage(original, epochs, observed, *, require_complete=True):
    """Bind the full native prefix through C; retain later writes as later facts."""
    prior = original
    expected_changes = []
    for epoch in epochs:
        saved = ([epoch['migrationRaw']] if 'migrationRaw' in epoch else []) + [event['raw'] for event in epoch['events'] if event['kind']=='save']
        for value in saved:
            if value != prior:
                expected_changes.append((prior,value))
                prior = value
    current_events = [row for row in observed if row['event'].get('key')==KEY or row['eventName']=='domStorageItemsCleared']
    complete = len(current_events)>=len(expected_changes)
    if require_complete:
        check('all native current changes through manual C were actually observed',complete)
    prefix = current_events[:len(expected_changes)]
    origin = f'{urlparse(args.url).scheme}://{urlparse(args.url).netloc}'
    actual_changes = []
    for observed_event in prefix:
        event = observed_event['event']
        check('native replay never clears/removes the current slot or uses another origin before C',
              observed_event['eventName'] == 'domStorageItemUpdated'
              and event.get('storageId',{}).get('securityOrigin') == origin)
        actual_changes.append((event.get('oldValue'),event.get('newValue')))
    check('complete cross-document native current writes through C match all successful original save calls in exact order',
          actual_changes == expected_changes[:len(prefix)])
    return {'complete':complete,'throughC':copy.deepcopy(prefix),'afterC':copy.deepcopy(current_events[len(expected_changes):])}


def verify_r9_native_readbacks(epoch, audit):
    # Successful writeCandidate compares twice, writes only changed bytes, then
    # reads back. The only extra read accepted is the original storage listener's
    # explicitly marked, synchronous comparison between complete save calls.
    prior = epoch['sourceRaw']
    native = [(index,row) for index,row in enumerate(audit)
              if (row['operation'] in ('read','write-return') and row.get('key')==KEY)
              or (row['operation']=='storage-event' and row.get('key') in (KEY,None))]
    cursor, last_read = 0, -1
    listener_reads = []
    def consume(operation, value):
        nonlocal cursor, last_read
        check('all native IO through C is present at its exact original call boundary',cursor<len(native))
        index,row = native[cursor]
        check('original comparison reads, optional changed-byte write and final readback remain exact',
              row['operation']==operation and row.get('value')==value)
        cursor += 1
        if operation=='read':
            last_read = index
    # A pre-constructor event has no registered application listener yet. In
    # particular, do not mistake 5dd's following constructor read for an extra read.
    while cursor<len(native) and native[cursor][1]['operation']=='storage-event':
        cursor += 1
    consume('read',prior)
    for event in epoch['events']:
        if event['kind']!='save':
            continue
        while cursor<len(native) and native[cursor][1]['operation']=='storage-event':
            index,marker = native[cursor]
            check('an extra between-save comparison requires a trusted native storage event',marker.get('trusted') is True)
            cursor += 1
            check('the marked storage listener performs exactly one immediately following native read',
                  cursor<len(native) and native[cursor][0]==index+1)
            consume('read',prior)
            listener_reads.append({'eventIndex':index,'readIndex':last_read,'expectedRaw':prior})
        value = event['raw']
        consume('read',prior)
        consume('read',prior)
        if value!=prior:
            consume('write-return',value)
        consume('read',value)
        prior = value
    return {'throughCReadback':copy.deepcopy(audit[:last_read+1]),
            'afterCReadback':copy.deepcopy(audit[last_read+1:]),'storageListenerReads':listener_reads}


def complete_r9_native_replay(page, capture, original, migrated, label, manual_after):
    # Flush already-produced observations without touching application clocks or
    # invoking a handler. C is the original synchronous manual result, never the
    # subsequently read current slot (which may legitimately contain a later save).
    capture['trace'].cdp.send('Runtime.getIsolateId')
    snapshot = capture['trace'].snapshot()
    (out / f'r9-{label}-native-trace.json').write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding='utf-8')
    (out / f'r9-{label}-native-source-bindings.json').write_text(json.dumps(capture['navigations'],ensure_ascii=False,indent=2),encoding='utf-8')
    contexts = [row['executionContextId'] for row in snapshot['executedScripts'].values()]
    check('A to B to C uses exactly two verified native document contexts', len(contexts) == len(set(contexts)) == 2)
    first = capture['trace'].document_events(contexts[0])
    second = through_manual_save(capture['trace'].document_events(contexts[1]), manual_after)
    epochs = [to_replay_epoch(first), to_replay_epoch(second)]
    epochs[0]['migrationRaw'] = migrated
    check('independently replayed initial document starts from complete untouched r9 bytes', epochs[0]['sourceRaw'] == original)
    prior_saves = [event for event in epochs[0]['events'] if event['kind']=='save']
    check('reload constructor B reads the exact final successful old-document lifecycle save',
          bool(prior_saves) and epochs[1]['sourceRaw']==prior_saves[-1]['raw'])
    check('C is the original captured synchronous manual save result',
          epochs[1]['events'][-1]['kind']=='save' and epochs[1]['events'][-1]['reason']=='manual')
    current_c = epochs[1]['events'][-1]['raw']
    audit_c = events(page)
    readback_evidence = verify_r9_native_readbacks(epochs[1],audit_c)
    # This read-only native DOMStorage round trip drains already generated CDP
    # notifications. It supplies evidence only, never an input to the old engine.
    origin = f'{urlparse(args.url).scheme}://{urlparse(args.url).netloc}'
    deadline = time.monotonic() + 2
    while True:
        after_current = capture['storage']['session'].send('DOMStorage.getDOMStorageItems',
            {'storageId':{'securityOrigin':origin,'isLocalStorage':True}})
        cdp_rows = copy.deepcopy(capture['storage']['events'])
        storage_evidence = verify_r9_native_storage(original,epochs,cdp_rows,require_complete=False)
        if storage_evidence['complete']:
            break
        check('the already selected C native notification arrives within its bounded evidence wait',time.monotonic()<deadline)
        time.sleep(0.01)  # Host waits for this notification, not for a chosen game gap.
    (out / f'r9-{label}-native-storage-events.json').write_text(json.dumps(cdp_rows,ensure_ascii=False,indent=2),encoding='utf-8')
    (out / f'r9-{label}-manual-C-complete-audit.json').write_text(json.dumps(audit_c,ensure_ascii=False,indent=2),encoding='utf-8')
    (out / f'r9-{label}-manual-C-native-boundary.json').write_text(json.dumps(
        {'readbacks':readback_evidence,'storage':storage_evidence,'laterNativeStorageRead':after_current},ensure_ascii=False,indent=2),encoding='utf-8')
    check('A B and C retain the complete immutable historical backup bytes',raw(page,BACKUP)==original)
    request = {'schema':'infinity-native-frame-replay-input-v1','originalRaw':original,'epochs':epochs}
    (out / f'r9-{label}-native-replay-input.json').write_text(json.dumps(request,ensure_ascii=False,indent=2),encoding='utf-8')
    (out / f'r9-{label}-constructor-B-current.json').write_bytes(epochs[1]['sourceRaw'].encode('utf-8'))
    (out / f'r9-{label}-manual-C-current.json').write_bytes(current_c.encode('utf-8'))
    command = ['node','--import','tsx',str(Path(__file__).with_name('r12-native-replay-oracle.mjs')),args.r11_source]
    process = subprocess.run(command,input=json.dumps(request),text=True,capture_output=True,timeout=30,check=False,cwd=Path(__file__).resolve().parent.parent)
    (out / f'r9-{label}-native-replay-stdout.json').write_text(process.stdout,encoding='utf-8')
    (out / f'r9-{label}-native-replay-stderr.txt').write_text(process.stderr,encoding='utf-8')
    check('fixed predecessor independently replays both native epochs and every complete state exactly',process.returncode==0)
    return verify_r9_replay_result(original,request,json.loads(process.stdout))


def capture_failure(error, page):
    """Each artifact is independent; preserve the original exception if any capture fails."""
    global failure
    failure = {'case':case,'error':repr(error),'traceback':traceback.format_exc(),'captureErrors':[]}
    def attempt(label, operation):
        try:
            operation()
        except BaseException as capture_error:
            failure['captureErrors'].append({'artifact':label,'error':repr(capture_error)})
    if globals().get('active_native_trace') is not None:
        attempt('native-navigation',lambda:capture_r9_navigation_evidence(active_native_trace,active_native_trace.get('lastDocumentResponse'),suffix='failure'))
        attempt('native-trace',lambda:(out/'failure-native-trace.json').write_text(json.dumps(active_native_trace['trace'].snapshot(),ensure_ascii=False,indent=2),encoding='utf-8'))
    if page is not None:
        for label,key in (('current',KEY),('backup',BACKUP)):
            def save_raw(label=label,key=key):
                value = page.evaluate('key => window.__saveNativeRead(key)',key)
                if value is None:
                    (out/f'failure-{label}-missing.json').write_text('null\n',encoding='utf-8')
                else:
                    (out/f'failure-{label}.json').write_bytes(value.encode('utf-8'))
            attempt(label,save_raw)
        attempt('complete-audit',lambda:(out/'failure-complete-audit.json').write_text(json.dumps(events(page),ensure_ascii=False,indent=2),encoding='utf-8'))
        attempt('summary-audit',lambda:capture_audit(page,'failure'))
        attempt('dom',lambda:(out/'failure-dom.html').write_text(page.content(),encoding='utf-8'))
        attempt('screenshot',lambda:screenshot(page,'failure.png'))
    attempt('failure-report',lambda:(out/'failure-diagnostic.json').write_text(json.dumps(failure,ensure_ascii=False,indent=2),encoding='utf-8'))


@contextmanager
def capture_live_failure():
    try:
        yield
    except BaseException as error:
        try:
            capture_failure(error,active_page)
        except BaseException:
            pass  # Never replace the original native assertion with a capture error.
        raise


def expected_r10_startup(original, candidate, observed):
    """Strict metadata + complete envelope oracle; no current-state field is an oracle input."""
    source = json.loads(original)
    now = candidate["savedAt"]
    cap_seconds = min(28800, max(7200, 7200 + max(0, source["state"]["offlineBonusHours"]) * 3600))
    raw_seconds = max(0, (now - source["lastTickAt"]) / 1000)
    # Native JSON Number values use integer spelling when mathematically integral.
    # Preserve exact value/type semantics rather than manufacturing Python 1.0.
    number = lambda value: int(value) if value == int(value) else value
    expected_metadata = {"schema": "infinity-fixed-r10-startup-oracle-v1",
                         "sourceSha": "ac3cce98403bea1e7162bcb4092e4cfeeb448a9a",
                         "dependencyIdentity": {
                             "breakInfinity": {"version": "2.2.0", "commonSha256": "f3be0918a5ed463a887e5b622574de81dd035c393021af7db9485f34400bda06", "esmSha256": "1e1825ab4fa711c16fc7225790d0163cf6b5f5611ab77b39cbb2cd381cb8f71a"},
                             "padEnd": {"version": "1.0.2", "entrySha256": "063c31f8b5eeb14835a8a358b0dc0099528a5b4719b25057db9e48c752f9c330"}},
                         "inputRawSha256": hashlib.sha256(original.encode("utf-8")).hexdigest(),
                         "sourceSavedAt": source["savedAt"], "sourceLastTickAt": source["lastTickAt"],
                         "constructorNow": now, "gapMilliseconds": now - source["lastTickAt"],
                         "capSeconds": number(cap_seconds), "appliedSeconds": number(min(raw_seconds, cap_seconds)), "capped": raw_seconds > cap_seconds}
    check("startup candidate is a strict current envelope with one paired observed constructor clock",
          candidate["schema"] == source["schema"] and candidate["version"] == source["version"] == 9 and
          candidate["revision"] == CURRENT_REVISION and candidate["lastTickAt"] == now and
          type(now) is int and now >= 0)
    check("independent archived oracle metadata binds the exact source bytes and constructor timestamp",
          set(observed) == set(expected_metadata) | {"state", "adoptedSegmentsSeconds", "npcElapsedSeconds", "adoptedTimeObservation"} and all(exact_json(observed.get(key), value) for key, value in expected_metadata.items()))
    npc_elapsed = npc_elapsed_from_segments(observed['adoptedSegmentsSeconds'])
    check('old-engine actual adopted segments reproduce exact independent NPC age without tolerance',
          observed['adoptedTimeObservation'] == 'old-totalTime-add; full unobserved old-state equivalence verified'
          and type(observed['npcElapsedSeconds']) in (int, float) and observed['npcElapsedSeconds'] == npc_elapsed)
    return {**source, "revision": CURRENT_REVISION, "savedAt": now, "lastTickAt": now,
            "state": lift_r10_state_to_r12(observed["state"], npc_elapsed=npc_elapsed)}


def run_r10_startup_oracle(original, candidate):
    # The subprocess sees old bytes and one observed wall timestamp ONLY. It
    # imports actual SHA-pinned archived reader/offline code, not current logic.
    request = {"originalRaw": original, "constructorNow": candidate["savedAt"]}
    command = ["node", "--import", "tsx", str(Path(__file__).with_name("r10-startup-oracle.mjs")), args.r10_source]
    result = subprocess.run(command, input=json.dumps(request), text=True, capture_output=True,
                            timeout=20, check=False, cwd=Path(__file__).resolve().parent.parent)
    (out / "r10-startup-oracle.stdout.json").write_text(result.stdout, encoding="utf-8")
    (out / "r10-startup-oracle.stderr.log").write_text(result.stderr, encoding="utf-8")
    check("actual fixed r10 reader and catch-up subprocess completes successfully", result.returncode == 0)
    observed = json.loads(result.stdout)
    expected = expected_r10_startup(original, candidate, observed)
    (out / "r10-startup-exact-old-semantics-expected.json").write_text(json.dumps(expected, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "r10-startup-exact-old-semantics-diff.json").write_text(json.dumps(migration_differences(expected, candidate, "$save"), ensure_ascii=False, indent=2), encoding="utf-8")
    return expected


def expected_r11_startup(original, candidate, observed):
    """Full fixed-ca5 predecessor expectation; only its observed steps set NPC age."""
    source = json.loads(original)
    now = candidate['savedAt']
    check('legacy startup source is a genuine supported old envelope with paired original clocks',
          type(source['revision']) is int and 2 <= source['revision'] <= 11
          and source['schema'] == 'infinity-original-p4' and source['version'] == 9
          and type(source['savedAt']) is int and source['savedAt'] >= 0
          and type(source['lastTickAt']) is int and source['lastTickAt'] == source['savedAt'])
    check('ca5 startup comparison uses a strict current envelope and one observed constructor clock',
          candidate['schema'] == source['schema'] and candidate['version'] == 9
          and candidate['revision'] == CURRENT_REVISION and type(now) is int and now >= 0
          and candidate['lastTickAt'] == now)
    # Match JS JSON numeric spelling without relaxing any scalar type or value.
    number = lambda value: int(value) if value == int(value) else value
    cap = number(min(28800, max(7200, 7200 + max(0, source['state']['offlineBonusHours']) * 3600)))
    raw_seconds = number(max(0, (now - source['lastTickAt']) / 1000))
    metadata = {
        'schema': 'infinity-fixed-r11-startup-oracle-v1',
        'sourceSha': 'ca5ef0c769856f2c4c8925e76a5c7d322822fe1b',
        'dependencyIdentity': {
            'breakInfinity': {'version':'2.2.0','commonSha256':'f3be0918a5ed463a887e5b622574de81dd035c393021af7db9485f34400bda06','esmSha256':'1e1825ab4fa711c16fc7225790d0163cf6b5f5611ab77b39cbb2cd381cb8f71a'},
            'padEnd': {'version':'1.0.2','entrySha256':'063c31f8b5eeb14835a8a358b0dc0099528a5b4719b25057db9e48c752f9c330'}},
        'sourceRevision': source['revision'],
        'sourceEnvelope': {key:value for key,value in source.items() if key != 'state'},
        'inputRawSha256': hashlib.sha256(original.encode('utf-8')).hexdigest(),
        'sourceSavedAt': source['savedAt'], 'sourceLastTickAt': source['lastTickAt'],
        'constructorNow': now, 'gapMilliseconds': now - source['lastTickAt'],
        'rawSeconds': raw_seconds, 'capSeconds': cap, 'appliedSeconds': min(raw_seconds,cap),
        'capped': raw_seconds > cap,
        'oldObservedAndUnobservedStateEqual': True,
        'adoptedTimeObservation': 'old-totalTime-add; full unobserved old-state equivalence verified',
    }
    check('complete ca5 oracle identity, source envelope, timing and observation metadata match exactly',
          set(observed) == set(metadata) | {'state','adoptedSegmentsSeconds','npcElapsedSeconds'}
          and all(exact_json(observed.get(key),value) for key,value in metadata.items()))
    age = npc_elapsed_from_segments(observed['adoptedSegmentsSeconds'])
    check('ca5 adopted segment sequence folds to the exact declared age without nominal-time replacement',
          type(observed['npcElapsedSeconds']) in (int,float) and observed['npcElapsedSeconds'] == age)
    return {**source, 'revision':CURRENT_REVISION, 'savedAt':now, 'lastTickAt':now,
            'state':lift_r11_state_to_r12(observed['state'],npc_elapsed=age)}


def run_r11_startup_oracle(original, candidate):
    # No candidate state, age, balances, IDs or timers enter this old-engine request.
    request = {'originalRaw': original, 'constructorNow': candidate['savedAt']}
    command = ['node','--import','tsx',str(Path(__file__).with_name('r11-startup-oracle.mjs')),args.r11_source]
    result = subprocess.run(command,input=json.dumps(request),text=True,capture_output=True,
                            timeout=20,check=False,cwd=Path(__file__).resolve().parent.parent)
    source = json.loads(original)
    stem = f"r{source['revision']}-ca5-startup-{hashlib.sha256(original.encode('utf-8')).hexdigest()[:16]}"
    (out / (stem+'-original.json')).write_text(original,encoding='utf-8')
    (out / (stem+'-oracle.stdout.json')).write_text(result.stdout,encoding='utf-8')
    (out / (stem+'-oracle.stderr.log')).write_text(result.stderr,encoding='utf-8')
    check('actual pinned ca5 reader and observed/unobserved catch-up subprocess completes',result.returncode == 0)
    expected = expected_r11_startup(original,candidate,json.loads(result.stdout))
    (out / (stem+'-expected.json')).write_text(json.dumps(expected,ensure_ascii=False,indent=2),encoding='utf-8')
    (out / (stem+'-diff.json')).write_text(json.dumps(migration_differences(expected,candidate,'$save'),ensure_ascii=False,indent=2),encoding='utf-8')
    return expected


def select_save(page):
    modal = page.locator('[data-bind="offline-modal"]')
    if modal.is_visible():
        page.locator('[data-action="dismiss-offline"]').click()
    page.locator('[data-tab="save"]').click()
    expect(page.locator('[data-tab-panel="save"]')).to_be_visible()


def import_text(page, text):
    page.locator('[data-bind="transfer"]').fill(text)
    page.locator('[data-action="import-text"]').click()


def status(page):
    return page.locator('[data-bind="status"]').inner_text()


def reset(page, accept):
    page.once("dialog", lambda dialog: dialog.accept() if accept else dialog.dismiss())
    page.locator('[data-action="reset"]').click()


def download_raw(page, filename):
    with page.expect_download() as pending:
        page.locator('[data-action="export"]').click()
    download = pending.value
    check("download reports no failure", download.failure() is None)
    path = out / filename
    download.save_as(path)
    return path.read_bytes().decode("utf-8")


def screenshot(page, filename):
    page.screenshot(path=str(out / filename), full_page=True)


# All healthy calls delegate to the captured, original browser Storage methods.
# Native reads inside the UI observer bypass the audit so they cannot accidentally
# count as the application's mandatory post-write verification.
AUDIT = r"""(() => {
 window.__fileImportConfirmations=[];
 const nativeConfirm=window.confirm.bind(window);
 window.confirm=message=>{window.__fileImportConfirmations.push(String(message));return nativeConfirm(message);};
  const key = __KEY__, backup = __BACKUP__;
  const get = Storage.prototype.getItem;
  const set = Storage.prototype.setItem;
  const remove = Storage.prototype.removeItem;
  window.__saveNativeStorage = localStorage instanceof Storage &&
    /\[native code\]/.test(Function.prototype.toString.call(get)) &&
    /\[native code\]/.test(Function.prototype.toString.call(set));
  window.__saveAudit = [];
  window.__saveFault = null;
  window.__saveWrittenKeys = new Set();
  window.__saveNativeRead = k => get.call(localStorage, k);
  const watched = k => k === key || k === backup || k.startsWith(backup + '.');
  const nativeWall = Date.now.bind(Date), nativePerformance = performance.now.bind(performance);
  const log = event => window.__saveAudit.push({wallAt:nativeWall(),performanceAt:nativePerformance(),...event});
  Storage.prototype.getItem = function(k) {
    k = String(k);
    const fault = window.__saveFault;
    if (this === localStorage && fault && fault.operation === 'read' &&
        (fault.target === 'current' ? k === key : k.startsWith(backup)) &&
        (!fault.afterWrite || window.__saveWrittenKeys.has(k))) {
      log({operation: 'read-throw', key: k, injected: true});
      throw new DOMException('Synthetic storage read fault', 'SecurityError');
    }
    const value = get.call(this, k);
    if (this === localStorage && watched(k)) log({operation: 'read', key: k, value});
    return value;
  };
  Storage.prototype.setItem = function(k, v) {
    k = String(k); v = String(v);
    if (this !== localStorage) return set.call(this, k, v);
    const fault = window.__saveFault;
    const inject = fault && fault.operation === 'write' &&
      (fault.target === 'all' || (fault.target === 'current' ? k === key : k.startsWith(backup)));
    if (!watched(k) && !inject) return set.call(this, k, v);
    log({operation: 'write-attempt', key: k, value: v});
    if (inject) {
      log({operation: 'write-' + fault.mode, key: k, injected: true});
      if (fault.mode === 'throw') throw new DOMException('Synthetic quota fault', 'QuotaExceededError');
      if (fault.mode === 'drop') return;
      throw new Error('Unknown browser test fault');
    }
    set.call(this, k, v);
    window.__saveWrittenKeys.add(k);
    log({operation: 'write-return', key: k, value: v});
  };
  Storage.prototype.removeItem = function(k) {
    k = String(k);
    if (this === localStorage && watched(k)) log({operation: 'remove', key: k});
    return remove.call(this, k);
  };
  window.addEventListener('storage', e => {
    if (e.storageArea === localStorage && (e.key === null || watched(e.key))) {
      log({operation: 'storage-event', key: e.key, trusted: e.isTrusted, value: e.newValue});
    }
  });
  let lastStatus = null;
  new MutationObserver(() => {
    const node = document.querySelector('[data-bind="status"]');
    if (!node || node.textContent === lastStatus) return;
    lastStatus = node.textContent;
    log({operation: 'ui-status', text: lastStatus,
      current: get.call(localStorage, key),
      planet: document.querySelector('[data-bind="ov-planet"]')?.textContent});
  }).observe(document, {subtree: true, childList: true, characterData: true});
})();""".replace("__KEY__", json.dumps(KEY)).replace("__BACKUP__", json.dumps(BACKUP))


def boot(seed, extra=None, startup_fault=None, native_plan=None):
    global active_page, active_native_trace
    active_native_trace = None
    parsed = urlparse(args.url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Native acceptance requires an HTTP(S) URL")
    origin = f"{parsed.scheme}://{parsed.netloc}"
    values = {LEGACY: LEGACY_RAW, "infinity.ui.tab": "save"}
    if seed is not None:
        values[KEY] = seed
    values.update(extra or {})
    context = browser.new_context(
        viewport={"width": 1440, "height": 1000}, accept_downloads=True,
        storage_state={"cookies": [], "origins": [{"origin": origin,
            "localStorage": [{"name": k, "value": v} for k, v in values.items()]}]},
    )
    # A single init script establishes deterministic wrapper/fault ordering before
    # any application module executes. Separate init scripts have no order guarantee.
    startup = "\nwindow.__saveFault = " + json.dumps(startup_fault) + ";"
    context.add_init_script(AUDIT + startup)
    page = context.new_page()
    active_page = page
    attach_page(page)
    if native_plan is not None:
        active_native_trace = start_r9_native_trace(page,native_plan)
    response = page.goto(args.url, wait_until="networkidle")
    check("production page served over actual HTTP", response is not None and response.status == 200)
    if active_native_trace is not None:
        verify_r9_trace_navigation(active_native_trace,response)
    page.locator('[data-bind="amount-metal"]').wait_for()
    check("Storage backing is native browser storage", page.evaluate("window.__saveNativeStorage"))
    select_save(page)
    return context, page


def attach_page(page):
    page.set_default_timeout(10_000)
    page.on("pageerror", lambda error: errors.append({"case": case, "error": str(error)}))
    page.on("requestfailed", lambda request: failed_requests.append({"case": case, "url": request.url}))


def verify_commit(page, original, success):
    expect(page.locator('[data-bind="status"]')).to_have_text(success)
    persisted = raw(page)
    rows = events(page)
    successes = [(i, row) for i, row in enumerate(rows)
                 if row["operation"] == "ui-status" and row["text"] == success]
    check("success was observed in the actual status DOM", bool(successes))
    success_index, observed = successes[0]
    check("current save was durable at first UI success", observed["current"] == persisted)
    before_success = rows[:success_index]
    writes = [(i, row) for i, row in enumerate(before_success)
              if row["operation"] == "write-return" and row["key"] == KEY]
    check("current write returned before UI success", bool(writes))
    write_index = writes[-1][0]
    check("application read back exact current bytes before UI success", any(
        row["operation"] == "read" and row["key"] == KEY and row["value"] == persisted
        for row in before_success[write_index + 1:]))
    if original is not None:
        check("exact original bytes were verified before the current write", any(
            row["operation"] == "read" and row["key"].startswith(BACKUP)
            and row["value"] == original for row in before_success[:write_index]))
    check("replacement uses setItem rather than deleting the current slot", not any(
        row["operation"] == "remove" and row["key"] == KEY for row in rows))
    check("separate legacy save is untouched", raw(page, LEGACY) == LEGACY_RAW)
    capture_audit(page, success)
    return persisted


def assert_no_replacement(page, original, original_name):
    check("current raw bytes are unchanged", raw(page) == original)
    check("live original planet remains displayed", planet(page) == original_name)
    check("no false import/reset success was displayed", not any(
        row["operation"] == "ui-status" and row["text"] in
        ("已导入并存入本地", "已重置并存入本地") for row in events(page)))


try:
    with sync_playwright() as playwright, capture_live_failure():
        executable = args.chromium or shutil.which("google-chrome") or shutil.which("chromium")
        if not executable:
            raise RuntimeError("Chrome/Chromium is required; native acceptance has no inline fallback")
        browser = playwright.chromium.launch(executable_path=executable, headless=True, args=["--no-sandbox"])

        case = "supported import transaction"
        original, incoming = raw_fixture(), raw_fixture("imported")
        context, page = boot(original)
        clear_audit(page)
        import_text(page, incoming)
        committed = verify_commit(page, original, "已导入并存入本地")
        check("imported planet is visible only after successful commit", planet(page) == name_of(incoming))
        check("persisted file contains imported state", name_of(committed) == name_of(incoming))
        check("backup retains exact original bytes", raw(page, BACKUP) == original)
        check("transfer text matches committed bytes", page.locator('[data-bind="transfer"]').input_value() == committed)
        screenshot(page, "import-committed.png")
        page.reload(wait_until="networkidle")
        select_save(page)
        check("native page reload restores imported state", planet(page) == name_of(incoming))
        check("reload leaves immutable backup untouched", raw(page, BACKUP) == original)
        context.close()

        case = "invalid import preserves current state"
        original = raw_fixture()
        context, page = boot(original)
        invalids = {"malformed JSON": "{not-json", "empty file": ""}
        for label, field, value in (("old version", "version", fixtures["current"]["version"] - 1),
                                    ("future version", "version", fixtures["current"]["version"] + 1),
                                    ("foreign schema", "schema", "synthetic-foreign-schema"),
                                    ("unsupported revision", "revision", 999)):
            invalid = json.loads(raw_fixture("imported"))
            invalid[field] = value
            invalids[label] = json.dumps(invalid, ensure_ascii=False)
        invalid = json.loads(raw_fixture("imported"))
        del invalid["state"]["orders"]["nextWorkId"]
        invalids["r6 missing mandatory work counter"] = json.dumps(invalid, ensure_ascii=False)
        invalid = copy.deepcopy(fixtures["paidR5"])
        invalid["state"]["orders"]["tasks"][0]["transport"] = None
        invalids["actual r5 source smuggles null r6 transport field"] = json.dumps(invalid, ensure_ascii=False)
        invalid = copy.deepcopy(fixtures["paidR5"])
        invalid["revision"] = SAVE_REVISION
        invalid["state"]["orders"]["nextWorkId"] = 1
        invalid["state"]["researchTemplates"] = {"nextTemplateId": 1, "templates": []}
        invalid["state"]["formations"] = {"nextFormationId": 1, "entries": []}
        invalid["state"]["buildingTemplates"] = {"nextTemplateId": 1, "templates": []}
        for task in invalid["state"]["orders"]["tasks"]:
            task["transport"], task["currentWork"], task["formationOrigin"] = None, None, None
        invalid["state"] = lift_legacy_state_to_r12(invalid["state"], source_revision=9, grant_job_floor=invalid["state"]["orders"]["nextJobId"])
        invalids["synthetic r6 missing mandatory fleet owner tag"] = json.dumps(invalid, ensure_ascii=False)
        invalid = json.loads(raw_fixture("imported"))
        del invalid["state"]["researchTemplates"]
        invalids["r7 missing mandatory research intent"] = json.dumps(invalid, ensure_ascii=False)
        invalid = json.loads(raw_fixture("imported"))
        invalid["state"]["researchTemplates"]["budget"] = None
        invalids["r7 library smuggles budget"] = json.dumps(invalid, ensure_ascii=False)
        invalid = copy.deepcopy(fixtures["transportR6"]["outbound"])
        invalid["state"]["researchTemplates"] = {"nextTemplateId": 1, "templates": []}
        invalids["actual r6 source smuggles empty r7 intent"] = json.dumps(invalid, ensure_ascii=False)
        invalid = json.loads(raw_fixture("imported"))
        del invalid["state"]["formations"]
        invalids["r8 missing mandatory fleet design library"] = json.dumps(invalid, ensure_ascii=False)
        invalid = copy.deepcopy(fixtures["transportR7"]["outbound"])
        invalid["state"]["formations"] = {"nextFormationId": 1, "entries": []}
        invalids["actual r7 smuggles even empty r8 formations"] = json.dumps(invalid, ensure_ascii=False)
        invalid = copy.deepcopy(fixtures["transportR7"]["returning"])
        invalid["state"]["orders"]["tasks"][0]["formationOrigin"] = None
        invalids["actual r7 smuggles even null r8 order origin"] = json.dumps(invalid, ensure_ascii=False)
        invalid = json.loads(raw_fixture("imported"))
        del invalid["state"]["buildingTemplates"]
        invalids["r9 missing mandatory building intention library"] = json.dumps(invalid, ensure_ascii=False)
        invalid = copy.deepcopy(fixtures["transportR8"]["outbound"])
        invalid["state"]["buildingTemplates"] = {"nextTemplateId": 1, "templates": []}
        invalids["actual r8 smuggles even empty r9 building intentions"] = json.dumps(invalid, ensure_ascii=False)
        for label, mutate in (
            ("r10 missing fixed floor", lambda state: state.pop("terraformerGrantJobFloor")),
            ("r10 missing planet grant ledger", lambda state: state["planets"][0].pop("terraformerFields")),
            ("r10 null planet grant ledger", lambda state: state["planets"][0].__setitem__("terraformerFields", None)),
            ("r10 unknown grant ledger child", lambda state: state["planets"][0]["terraformerFields"].__setitem__("invented", 0)),
            ("r10 string grant count", lambda state: state["planets"][0]["terraformerFields"].__setitem__("grantedLevels", "0")),
            ("r10 altered field equality", lambda state: state["planets"][0]["terraformerFields"].__setitem__("base", state["planets"][0]["fieldsMax"] - 1)),
            ("r10 floor beyond issued counter", lambda state: state.__setitem__("terraformerGrantJobFloor", state["orders"]["nextJobId"] + 1)),
        ):
            invalid = json.loads(raw_fixture("imported")); mutate(invalid["state"])
            invalids[label] = json.dumps(invalid, ensure_ascii=False)
        for label, value in (("missing", "__missing__"), ("array", []), ("partial active job", {"kind": "demolition"}), ("number", 0)):
            invalid = json.loads(raw_fixture("imported"))
            if value == "__missing__":
                invalid["state"]["planets"][0].pop("demolition")
            else:
                invalid["state"]["planets"][0]["demolition"] = value
            invalids["r11 invalid demolition slot: " + label] = json.dumps(invalid, ensure_ascii=False)
        for label, value in (
            ('missing', None), ('wrong model', {'model':'other','elapsedSeconds':0}),
            ('wrong type', {'model':'fixed-production-v1','elapsedSeconds':'0'}),
            ('negative', {'model':'fixed-production-v1','elapsedSeconds':-1}),
            ('over bound', {'model':'fixed-production-v1','elapsedSeconds':11901}),
            ('extra field', {'model':'fixed-production-v1','elapsedSeconds':0,'extra':False}),
        ):
            invalid = json.loads(raw_fixture('imported'))
            if label == 'missing':
                del invalid['state']['npcEconomy']
            else:
                invalid['state']['npcEconomy'] = value
            invalids['r12 invalid NPC metadata: ' + label] = json.dumps(invalid, ensure_ascii=False)
        for revision in range(2, 12):
            invalid = copy.deepcopy(fixtures['legacy'][str(revision)])
            invalid['state']['npcEconomy'] = None
            invalids[f'actual r{revision} smuggles even null r12 NPC field'] = json.dumps(invalid, ensure_ascii=False)
        for revision in (8, 9, 10):
            invalid = copy.deepcopy(fixtures["legacy"][str(revision)])
            invalid["state"]["planets"][0]["demolition"] = None
            invalids[f"actual r{revision} smuggles even null r11 demolition"] = json.dumps(invalid, ensure_ascii=False)
        for revision, fixture in ((8, fixtures["transportR8"]["outbound"]), (9, fixtures["historicalR9"]["current"])):
            for label, mutate in (
                ("even null floor", lambda state: state.__setitem__("terraformerGrantJobFloor", None)),
                ("even zero planet ledger", lambda state: state["planets"][0].__setitem__("terraformerFields", {"base": state["planets"][0]["fieldsMax"], "grantedLevels": 0})),
                ("nested grant metadata", lambda state: state["planets"][0]["resources"].__setitem__("nested", {"terraformerFields": None})),
            ):
                invalid = copy.deepcopy(fixture); mutate(invalid["state"])
                invalids[f"actual r{revision} smuggles {label}"] = json.dumps(invalid, ensure_ascii=False)
        for label, invalid in invalids.items():
            case = "invalid import: " + label
            clear_audit(page)
            import_text(page, invalid)
            expect(page.locator('[data-bind="status"]')).to_contain_text("导入失败")
            assert_no_replacement(page, original, name_of(original))
            check("invalid import never attempts a save or backup write", not any(
                row["operation"] == "write-attempt" for row in events(page)))
        screenshot(page, "invalid-import-preserved.png")
        context.close()

        case = "unsupported startup preserves and exports original"
        old = json.loads(raw_fixture())
        old["version"] -= 1
        # Intentional whitespace and non-ASCII text test byte preservation.
        old_raw = " \n" + json.dumps(old, ensure_ascii=False, indent=3) + "\n  "
        context, page = boot(old_raw)
        expect(page.locator('[data-bind="notice"]')).to_contain_text("原件已保留")
        check("unsupported startup did not overwrite stored bytes", raw(page) == old_raw)
        protected_planet = planet(page)
        clear_audit(page)
        page.locator('[data-action="save"]').click()
        check("manual save cannot overwrite unsupported original", raw(page) == old_raw)
        # Real elapsed time crosses the production 15-second autosave interval.
        page.wait_for_timeout(15_500)
        check("real-time autosave cannot overwrite protected original", raw(page) == old_raw)
        check("protected placeholder planet remains unchanged", planet(page) == protected_planet)
        exported = download_raw(page, "unsupported-original.json")
        check("download exports the exact unsupported raw bytes", exported == old_raw)
        check("export textarea contains the exact unsupported bytes", page.locator('[data-bind="transfer"]').input_value() == old_raw)
        check("protected export makes no current or backup write", not any(
            row["operation"] == "write-attempt" for row in events(page)))
        screenshot(page, "unsupported-protected.png")
        capture_audit(page, "protected save / real-time autosave / export")
        page.reload(wait_until="networkidle")
        select_save(page)
        check("beforeunload and native reload keep unsupported raw bytes", raw(page) == old_raw)
        clear_audit(page)
        import_text(page, raw_fixture("imported"))
        verify_commit(page, old_raw, "已导入并存入本地")
        check("explicit valid import preserves unsupported original in backup", raw(page, BACKUP) == old_raw)
        check("successful explicit import clears protection notice", page.locator('[data-bind="notice"]').is_hidden())
        context.close()

        for revision in (2, 3, 4, 5, 6, 7, 8, 9, 10, 11):
            case = f"supported same-schema r{revision} startup migration"
            legacy_raw = legacy_fixture(revision)
            context, page = boot(legacy_raw)
            if revision == 10:
                capture_startup_migration(page, legacy_raw, revision)
            migrated = verify_commit(page, legacy_raw, "已升级并保存本地存档")
            migrated_file = json.loads(migrated)
            check(f"supported migration produces revision {SAVE_REVISION}", migrated_file["revision"] == SAVE_REVISION)
            legacy_state = json.loads(legacy_raw)["state"]
            if "orders" in legacy_state:
                floor = legacy_state["orders"]["nextJobId"]
            else:
                check("pre-orders factory fixture has no paid queues to assign IDs", not legacy_state["research"]["queue"] and all(not p["buildQueue"] and not p["shipyardQueue"] for p in legacy_state["planets"]))
                floor = 1
            if revision == 10:
                check("actual r10 startup preserves exact fixed-reader catch-up semantics plus null demolition and independently adopted NPC time", exact_json(migrated_file, run_r10_startup_oracle(legacy_raw, migrated_file)))
            else:
                independent = run_r11_startup_oracle(legacy_raw,migrated_file)
                check('actual legacy startup preserves every ca5 field plus independently witnessed NPC age',exact_json(migrated_file,independent))
                check("migration creates exact zero ledgers with an independently fixed starting payment boundary", assert_zero_grant_metadata(migrated_file["state"], legacy_state, grant_job_floor=floor, npc_elapsed=independent['state']['npcEconomy']['elapsedSeconds']))
            check("migration never creates ring spending authorization", migrated_file["state"]["arcade"]["autoBatch"] is None)
            check("migration never creates finite order authorization", migrated_file["state"]["orders"]["tasks"] == [])
            check("migration never invents research intent", migrated_file["state"]["researchTemplates"] == {"nextTemplateId": 1, "templates": []})
            check("migration never invents building intentions", migrated_file["state"]["buildingTemplates"] == {"nextTemplateId": 1, "templates": []})
            check("migration never invents fleet designs", migrated_file["state"]["formations"] == {"nextFormationId": 1, "entries": []})
            check("migration retains original planet", planet(page) == name_of(legacy_raw))
            check(f"migration backup is byte-for-byte r{revision} original", raw(page, BACKUP) == legacy_raw)
            context.close()

        case = "actual r10 explicit text import is schema migration without offline catch-up"
        classification = "HTTP / native localStorage / actual archived r10 bytes / explicit import no-catchup contract"
        import_raw = legacy_fixture(10)
        (out / "r10-explicit-import-original.json").write_bytes(import_raw.encode("utf-8"))
        context, page = boot(None)
        original = raw(page)
        clear_audit(page)
        import_text(page, import_raw)
        committed = verify_commit(page, original, "已导入并存入本地")
        (out / "r10-explicit-import-current.json").write_bytes(committed.encode("utf-8"))
        imported = json.loads(committed)
        check("explicit old-r10 import adds only null slots and exact zero-age NPC metadata without elapsed simulation",
              exact_json(imported["state"], lift_r10_state_to_r12(json.loads(import_raw)["state"])) and
              imported["revision"] == CURRENT_REVISION and imported["savedAt"] == imported["lastTickAt"])
        context.close()
        classification = "HTTP / native localStorage"

        case = "armed r4 startup migration preserves exact ring authorization"
        armed_value = copy.deepcopy(fixtures["armedR4"])
        armed_value["savedAt"] = armed_value["lastTickAt"] = int(time.time() * 1000)
        armed_raw = json.dumps(armed_value, ensure_ascii=False, indent=2)
        context, page = boot(armed_raw)
        migrated = verify_commit(page, armed_raw, "已升级并保存本地存档")
        migrated_file = json.loads(migrated)
        check("r4 migration retains the armed source, IDs, cursor and budget",
              migrated_file["state"]["arcade"]["autoBatch"] == armed_value["state"]["arcade"]["autoBatch"])
        check("r4 migration backs up exact source bytes", raw(page, BACKUP) == armed_raw)
        check("r4 migration adds only an empty finite order plan list", migrated_file["state"]["orders"]["tasks"] == [])
        page.reload(wait_until="networkidle")
        select_save(page)
        page.locator('[data-action="save"]').click()
        check("r4 authority remains unchanged after native reload and save",
              json.loads(raw(page))["state"]["arcade"]["autoBatch"] == armed_value["state"]["arcade"]["autoBatch"])
        context.close()

        case = "actual r5 paid-plan and ordinary-fleet migration"
        paid_value = copy.deepcopy(fixtures["paidR5"])
        paid_value["savedAt"] = paid_value["lastTickAt"] = int(time.time() * 1000)
        paid_raw = json.dumps(paid_value, ensure_ascii=False, indent=2)
        context, page = boot(paid_raw)
        migrated = json.loads(verify_commit(page, paid_raw, "已升级并保存本地存档"))
        independent = run_r11_startup_oracle(paid_raw,migrated)
        check('paid r5 startup preserves every fixed-ca5 state field and exact observed NPC segments',exact_json(migrated,independent))
        check("r5 migration independently validates fixed payment boundary and every zero grant ledger", assert_zero_grant_metadata(migrated["state"], paid_value["state"], grant_job_floor=paid_value["state"]["orders"]["nextJobId"], npc_elapsed=independent['state']['npcEconomy']['elapsedSeconds']))
        migrated_orders = copy.deepcopy(migrated["state"]["orders"])
        check("r5 migration adds an empty research intent library", migrated["state"]["researchTemplates"] == {"nextTemplateId": 1, "templates": []})
        check("r5 upgrade introduces only an empty work counter", migrated_orders.pop("nextWorkId") == 1)
        for task in migrated_orders["tasks"]:
            check("real r5 paid plan never becomes transport permission",
                  task.pop("transport") is None and task.pop("currentWork") is None and task.pop("formationOrigin") is None)
        check("r5 paid identities, exact ledgers and paused task preserved", migrated_orders == paid_value["state"]["orders"])
        old_queue, new_queue = paid_value["state"]["planets"][0]["buildQueue"], migrated["state"]["planets"][0]["buildQueue"]
        check("actual r5 paid queue remains present", len(old_queue) == len(new_queue) == 1)
        check("r5 real paid queue keeps price and ownership", all(new_queue[0][key] == old_queue[0][key]
              for key in ("jobId", "taskId", "source", "building", "targetLevel", "paid", "totalSeconds")))
        check("r5 paid timer advances only within original remaining duration",
              0 < new_queue[0]["remainingSeconds"] <= old_queue[0]["remainingSeconds"])
        old_fleet, new_fleet = paid_value["state"]["fleets"][0], migrated["state"]["fleets"][0]
        check("r5 ordinary fleet cannot become owned transport", new_fleet["orderTransport"] is None)
        check("r5 fleet keeps identity, manifest and locked duration", all(new_fleet[key] == old_fleet[key]
              for key in ("id", "originId", "target", "mission", "cargo", "ships", "duration", "returning")))
        check("r5 paid migration preserves exact original bytes", raw(page, BACKUP) == paid_raw)
        context.close()

        case = "r5 paid source backup failure freezes original work and exports original bytes"
        context, page = boot(paid_raw, startup_fault={"operation": "write", "target": "backup", "mode": "throw"})
        check("paid r5 source remains byte-identical after backup denial", raw(page) == paid_raw)
        check("paid r5 original remains exportable", download_raw(page, "r5-paid-protected-original.json") == paid_raw)
        check("failed paid r5 upgrade retains readable source", planet(page) == name_of(paid_raw))
        context.close()

        # These files come from the actual archived r6 serializer and actual dispatch,
        # paid-research, pause and recall primitives. Only the wall-clock envelope is
        # explicitly held in the future to isolate migration from offline simulation.
        classification = "HTTP / native localStorage / actual r6 source / controlled no-catchup timestamp"
        for phase in ("outbound", "returning"):
            case = f"actual r6 {phase} complete transport and paid-research migration"
            r6_value = copy.deepcopy(fixtures["transportR6"][phase])
            check("fixture is genuinely source-r6, with no r7 field", r6_value["revision"] == 6 and "researchTemplates" not in r6_value["state"])
            r6_value["savedAt"] = r6_value["lastTickAt"] = int(time.time() * 1000) + 60_000
            r6_raw = json.dumps(r6_value, ensure_ascii=False, indent=2)
            context, page = boot(r6_raw)
            migrated = json.loads(verify_commit(page, r6_raw, "已升级并保存本地存档"))
            check("r6 migration independently validates every new grant field", assert_zero_grant_metadata(migrated["state"], r6_value["state"], grant_job_floor=r6_value["state"]["orders"]["nextJobId"], npc_elapsed=0))
            projection = project_verified_r12_metadata(migrated["state"], r6_value["state"], grant_job_floor=r6_value["state"]["orders"]["nextJobId"], npc_elapsed=0)
            check("source has no building template field", "buildingTemplates" not in r6_value["state"])
            check("migration adds only the exact empty building intention library", projection.pop("buildingTemplates") == {"nextTemplateId": 1, "templates": []})
            check("r6 migration creates exactly an empty intent library", projection.pop("researchTemplates") == {"nextTemplateId": 1, "templates": []})
            check("r6 migration creates exactly an empty formation library", projection.pop("formations") == {"nextFormationId": 1, "entries": []})
            for task in projection["orders"]["tasks"]:
                check("r6 orders gain only a null formation origin", task.pop("formationOrigin") is None)
            check("r6 complete prior state projection is unchanged", exact_json(projection, r6_value["state"]))
            check("r6 genuine unpaid work and in-flight phase remain", projection["orders"]["tasks"][0]["currentWork"]["stage"] == "pending" and projection["orders"]["tasks"][0]["transport"]["trips"][0]["phase"]["kind"] == phase)
            check("r6 real paid research remains owned by its paused plan", len(projection["research"]["queue"]) == 1 and projection["research"]["queue"][0]["source"] == "plan" and all(t["status"] == "paused" for t in projection["orders"]["tasks"]))
            expect(page.locator('[data-bind="notice"]')).to_contain_text("运输授权、回执")
            check("r6 migration notice does not claim old plans were empty", "有限计划为空" not in page.locator('[data-bind="notice"]').inner_text())
            screenshot(page, f"r6-{phase}-migration.png")
            page.reload(wait_until="networkidle")
            select_save(page)
            check("r6 exact source backup survives native reload", raw(page, BACKUP) == r6_raw)
            check("migrated state remains current r12 on reload", json.loads(raw(page))["state"]["researchTemplates"] == {"nextTemplateId": 1, "templates": []})
            context.close()

        classification = "HTTP / native Storage / actual r6 source / injected migration fault"
        for fault in ({"operation": "write", "target": "backup", "mode": "throw"},
                      {"operation": "write", "target": "backup", "mode": "drop"},
                      {"operation": "write", "target": "current", "mode": "throw"},
                      {"operation": "write", "target": "current", "mode": "drop"},
                      {"operation": "read", "target": "backup", "afterWrite": True},
                      {"operation": "read", "target": "current", "afterWrite": True}):
            case = "actual r6 paid transport source migration fault: " + json.dumps(fault, sort_keys=True)
            r6_value = copy.deepcopy(fixtures["transportR6"]["outbound"])
            r6_value["savedAt"] = r6_value["lastTickAt"] = int(time.time() * 1000) + 60_000
            r6_raw = json.dumps(r6_value, ensure_ascii=False, indent=2)
            context, page = boot(r6_raw, startup_fault=fault)
            expect(page.locator('[data-bind="notice"]')).to_contain_text("原件已保留")
            frozen_time, frozen_metal = page.locator('[data-bind="played"]').text_content(), page.locator('[data-bind="amount-metal"]').text_content()
            page.wait_for_timeout(1_200)
            check("failed r6 migration freezes readable simulation", page.locator('[data-bind="played"]').text_content() == frozen_time and page.locator('[data-bind="amount-metal"]').text_content() == frozen_metal)
            check("failed r6 migration keeps the readable original planet", planet(page) == name_of(r6_raw))
            check("failed r6 migration exports the exact original despite readback failure", download_raw(page, f"r6-{fault['operation']}-{fault['target']}-{fault.get('mode', 'readback')}-original.json") == r6_raw)
            expected_event = "read-throw" if fault["operation"] == "read" else "write-" + fault["mode"]
            check("r6 source fault was actually exercised", any(row["operation"] == expected_event and row.get("injected") for row in events(page)))
            persisted = page.evaluate("key => window.__saveNativeRead(key)", KEY)
            uncertain_write = fault["operation"] == "read" and fault["target"] == "current"
            if uncertain_write:
                check("uncertain r6 write remains on disk without a false rollback claim", json.loads(persisted)["revision"] == SAVE_REVISION)
            else:
                check("r6 original bytes survive denied or dropped replacement", persisted == r6_raw)
            check("r6 failed migration never announces success", not any(row["operation"] == "ui-status" and row["text"] == "已升级并保存本地存档" for row in events(page)))
            capture_audit(page, "actual r6 migration fault and exact protected export")
            page.evaluate("window.__saveFault = null")
            clear_audit(page)
            page.locator('[data-action="save"]').click()
            check("r6 failure cannot silently unlock writes after fault is removed", not any(row["operation"] == "write-attempt" for row in events(page)))
            capture_audit(page, "actual r6 source remains protected")
            context.close()

        # These files come from the actual archived r7 serializer and actual dispatch,
        # paid-research, pause and recall primitives. Only the wall-clock envelope is
        # explicitly held in the future to isolate migration from offline simulation.
        classification = "HTTP / native localStorage / actual r7 source / controlled no-catchup timestamp"
        for phase in ("outbound", "returning"):
            case = f"actual r7 {phase} complete transport and paid-research migration"
            r7_value = copy.deepcopy(fixtures["transportR7"][phase])
            check("fixture is genuine r7 with nonempty templates and no r8 formations", r7_value["revision"] == 7 and len(r7_value["state"]["researchTemplates"]["templates"]) == 2 and "formations" not in r7_value["state"])
            r7_value["savedAt"] = r7_value["lastTickAt"] = int(time.time() * 1000) + 60_000
            r7_raw = json.dumps(r7_value, ensure_ascii=False, indent=2)
            context, page = boot(r7_raw)
            migrated = json.loads(verify_commit(page, r7_raw, "已升级并保存本地存档"))
            check("r7 migration independently validates every new grant field", assert_zero_grant_metadata(migrated["state"], r7_value["state"], grant_job_floor=r7_value["state"]["orders"]["nextJobId"], npc_elapsed=0))
            projection = project_verified_r12_metadata(migrated["state"], r7_value["state"], grant_job_floor=r7_value["state"]["orders"]["nextJobId"], npc_elapsed=0)
            check("source has no building template field", "buildingTemplates" not in r7_value["state"])
            check("migration adds only the exact empty building intention library", projection.pop("buildingTemplates") == {"nextTemplateId": 1, "templates": []})
            check("r7 migration preserves complete nonempty research intent", projection["researchTemplates"] == r7_value["state"]["researchTemplates"])
            check("r7 migration creates exactly an empty formation library", projection.pop("formations") == {"nextFormationId": 1, "entries": []})
            for task in projection["orders"]["tasks"]:
                check("r7 orders gain only a null formation origin", task.pop("formationOrigin") is None)
            check("r7 complete prior state projection is unchanged", exact_json(projection, r7_value["state"]))
            check("r7 genuine unpaid work and in-flight phase remain", projection["orders"]["tasks"][0]["currentWork"]["stage"] == "pending" and projection["orders"]["tasks"][0]["transport"]["trips"][0]["phase"]["kind"] == phase)
            check("r7 real paid research remains owned by its paused plan", len(projection["research"]["queue"]) == 1 and projection["research"]["queue"][0]["source"] == "plan" and all(t["status"] == "paused" for t in projection["orders"]["tasks"]))
            expect(page.locator('[data-bind="notice"]')).to_contain_text("运输授权、回执")
            expect(page.locator('[data-bind="notice"]')).to_contain_text("已有研究模板完整保留")
            check("r7 real paid ship remainder survives migration", projection["planets"][0]["shipyardQueue"][0]["count"] == 5)
            check("r7 migration notice does not claim old plans were empty", "有限计划为空" not in page.locator('[data-bind="notice"]').inner_text())
            screenshot(page, f"r7-{phase}-migration.png")
            page.reload(wait_until="networkidle")
            select_save(page)
            check("r7 exact source backup survives native reload", raw(page, BACKUP) == r7_raw)
            check("r7 templates remain complete on native r12 reload", json.loads(raw(page))["state"]["researchTemplates"] == r7_value["state"]["researchTemplates"])
            context.close()

        classification = "HTTP / native Storage / actual r7 source / injected migration fault"
        for fault in ({"operation": "write", "target": "backup", "mode": "throw"},
                      {"operation": "write", "target": "backup", "mode": "drop"},
                      {"operation": "write", "target": "current", "mode": "throw"},
                      {"operation": "write", "target": "current", "mode": "drop"},
                      {"operation": "read", "target": "backup", "afterWrite": True},
                      {"operation": "read", "target": "current", "afterWrite": True}):
            case = "actual r7 paid transport source migration fault: " + json.dumps(fault, sort_keys=True)
            r7_value = copy.deepcopy(fixtures["transportR7"]["outbound"])
            r7_value["savedAt"] = r7_value["lastTickAt"] = int(time.time() * 1000) + 60_000
            r7_raw = json.dumps(r7_value, ensure_ascii=False, indent=2)
            context, page = boot(r7_raw, startup_fault=fault)
            expect(page.locator('[data-bind="notice"]')).to_contain_text("原件已保留")
            frozen_time, frozen_metal = page.locator('[data-bind="played"]').text_content(), page.locator('[data-bind="amount-metal"]').text_content()
            page.wait_for_timeout(1_200)
            check("failed r7 migration freezes readable simulation", page.locator('[data-bind="played"]').text_content() == frozen_time and page.locator('[data-bind="amount-metal"]').text_content() == frozen_metal)
            check("failed r7 migration keeps the readable original planet", planet(page) == name_of(r7_raw))
            check("failed r7 migration exports the exact original despite readback failure", download_raw(page, f"r7-{fault['operation']}-{fault['target']}-{fault.get('mode', 'readback')}-original.json") == r7_raw)
            expected_event = "read-throw" if fault["operation"] == "read" else "write-" + fault["mode"]
            check("r7 source fault was actually exercised", any(row["operation"] == expected_event and row.get("injected") for row in events(page)))
            persisted = page.evaluate("key => window.__saveNativeRead(key)", KEY)
            uncertain_write = fault["operation"] == "read" and fault["target"] == "current"
            if uncertain_write:
                check("uncertain r7 write remains on disk without a false rollback claim", json.loads(persisted)["revision"] == SAVE_REVISION)
            else:
                check("r7 original bytes survive denied or dropped replacement", persisted == r7_raw)
            check("r7 failed migration never announces success", not any(row["operation"] == "ui-status" and row["text"] == "已升级并保存本地存档" for row in events(page)))
            capture_audit(page, "actual r7 migration fault and exact protected export")
            page.evaluate("window.__saveFault = null")
            clear_audit(page)
            page.locator('[data-action="save"]').click()
            check("r7 failure cannot silently unlock writes after fault is removed", not any(row["operation"] == "write-attempt" for row in events(page)))
            capture_audit(page, "actual r7 source remains protected")
            context.close()
        classification = "HTTP / native localStorage / actual r8 source / controlled no-catchup timestamp"
        for phase in ("outbound", "returning"):
            case = f"actual r8 {phase} complete formations, origins and transport migration"
            r8_value = copy.deepcopy(fixtures["transportR8"][phase])
            source = r8_value["state"]
            check("fixture is genuine r8 with no new field", r8_value["revision"] == 8 and "buildingTemplates" not in source)
            check("real r8 research, edited formation and immutable original are nonempty",
                  len(source["researchTemplates"]["templates"]) == 2 and len(source["formations"]["entries"]) == 1
                  and source["formations"]["entries"][0]["revision"] == 2
                  and source["orders"]["tasks"][-1]["formationOrigin"]["formation"]["revision"] == 1)
            r8_value["savedAt"] = r8_value["lastTickAt"] = int(time.time() * 1000) + 60_000
            r8_raw = json.dumps(r8_value, ensure_ascii=False, indent=2)
            context, page = boot(r8_raw)
            migrated = json.loads(verify_commit(page, r8_raw, "已升级并保存本地存档"))
            check("r8 migration uses the actual r12 envelope", migrated["revision"] == SAVE_REVISION == CURRENT_REVISION)
            check("r8 migration independently validates every new grant field", assert_zero_grant_metadata(migrated["state"], source, grant_job_floor=source["orders"]["nextJobId"], npc_elapsed=0))
            check("all r8 values, scalar types and ordered arrays survive only prescribed metadata additions",
                  json.dumps(migrated["state"], sort_keys=True, separators=(",", ":")) ==
                  json.dumps(lift_legacy_state_to_r12(source, source_revision=8, grant_job_floor=source["orders"]["nextJobId"]), sort_keys=True, separators=(",", ":")))
            check("r8 owned transport keeps its genuine flight phase", source["orders"]["tasks"][0]["transport"]["trips"][0]["phase"]["kind"] == phase)
            check("r8 paid partial formation work and research survive", source["orders"]["tasks"][-1]["completedUnits"] == 2
                  and source["planets"][1]["shipyardQueue"][0]["count"] == 1 and len(source["research"]["queue"]) == 1)
            check("r8 migration preserves the exact original bytes", raw(page, BACKUP) == r8_raw)
            page.reload(wait_until="networkidle")
            select_save(page)
            reloaded = json.loads(raw(page))
            check("r8 exact backup and all saved intentions survive native r12 reload", raw(page, BACKUP) == r8_raw
                  and reloaded["revision"] == SAVE_REVISION
                  and reloaded["state"]["buildingTemplates"] == {"nextTemplateId": 1, "templates": []}
                  and reloaded["state"]["researchTemplates"] == source["researchTemplates"]
                  and reloaded["state"]["formations"] == source["formations"]
                  and reloaded["state"]["orders"]["tasks"][-1]["formationOrigin"] == source["orders"]["tasks"][-1]["formationOrigin"])
            context.close()

        # Fixed historical serializer/reader is an independent oracle, including
        # its explicitly labeled normalization row. Retain the original bytes;
        # only the test's wall-clock envelope is rebased to prevent catch-up.
        classification = "HTTP / native Storage / fixed native r9 source / controlled no-catchup timestamp"
        r9 = fixtures["terraformerR9"]
        check("r9 browser source is the exact fixed historical implementation", r9["sourceSha"] == "f96894eb1b32737ab403890ed83fdb3da41a0644")
        check("r9 native coverage retains all required independent old worlds", {row["name"] for row in r9["rows"]} == {
            "zero", "continuous_manual", "jump_protocol", "duplicate_manual", "already_built_manual", "full10000_plan",
            "9995_two_paid", "invalid_cancel_after_legacy_duplicate", "legacy_normalization", "complete_world_outbound", "complete_world_returning"})
        r9_native_plan = prepare_r9_trace_plan(playwright)
        for row in r9["rows"]:
            case = "actual r9 full-state migration: " + row["name"]
            archived_raw = row["raw"]
            check("immutable historical raw checksum is verified before browser seeding", hashlib.sha256(archived_raw.encode()).hexdigest() == row["rawSha256"])
            source_file = json.loads(archived_raw); oracle = copy.deepcopy(row["oldReaderOutput"])
            check("historical serializer and historical reader agree on version", source_file["revision"] == oracle["revision"] == 9 and source_file["version"] == oracle["version"] == 9)
            check("canonical and normalization inputs remain explicitly distinguished", type(row["canonical"]) is bool and row["synthetic"] is True and
                  (exact_json(source_file, oracle) if row["canonical"] else row["name"] == "legacy_normalization" and not exact_json(source_file, oracle)))
            (out / ("r9-" + row["name"] + "-immutable-original.json")).write_text(archived_raw, encoding="utf-8")
            source_file["savedAt"] = source_file["lastTickAt"] = int(time.time() * 1000) + 60_000
            source_raw = json.dumps(source_file, ensure_ascii=False, indent=2)
            source = oracle["state"]; floor = source["orders"]["nextJobId"]
            expected = lift_legacy_state_to_r12(source, source_revision=9, grant_job_floor=floor)
            startup_host_before = int(time.time() * 1000)
            context, page = boot(source_raw,native_plan=r9_native_plan)
            native_capture = active_native_trace
            committed_raw = verify_commit(page, source_raw, "已升级并保存本地存档")
            committed = json.loads(committed_raw)
            check("r9 migration is current and independently validates every new grant field", committed["revision"] == CURRENT_REVISION and assert_zero_grant_metadata(committed["state"], source, grant_job_floor=floor, npc_elapsed=0))
            check("all old r9 fields, scalar types and array positions match the fixed old-reader oracle", exact_json(committed["state"], expected))
            check("existing r9 building templates are preserved completely", exact_json(committed["state"]["buildingTemplates"], source["buildingTemplates"]))
            if row["name"].startswith("complete_world_"):
                check("complete r9 world really contains nonempty existing templates and every old payment source", len(source["buildingTemplates"]["templates"]) > 0 and
                      {job["source"] for planet_state in source["planets"] for job in planet_state["buildQueue"] if job["building"] == "terraformer"} == {"manual", "protocol", "plan"})
            check("r9 startup commits a fresh paired accounted clock after zero elapsed catch-up", committed["savedAt"] == committed["lastTickAt"] and startup_host_before <= committed["savedAt"] <= int(time.time() * 1000))
            expected_file = {"schema": source_file["schema"], "revision": CURRENT_REVISION, "version": source_file["version"],
                             "savedAt": committed["savedAt"], "lastTickAt": committed["lastTickAt"], "state": expected}
            expected_raw = page.evaluate("file => JSON.stringify(file, null, 2)", expected_file)
            check("entire migrated r9 envelope has the exact independent native property order and bytes", committed_raw == expected_raw)
            check("r9 startup backup preserves complete original input bytes including noncanonical representation", raw(page, BACKUP) == source_raw)
            expect(page.locator('[data-bind="notice"]')).to_contain_text("旧版已付地形改造器完成升级，不增加格数；本版新付款入队每级增加5总格，建筑本身占1格。")
            reload_observer = native_capture['storage']
            capture_reload_evidence(page,row['name'],source_raw,committed_raw,phase='before',observer=reload_observer)
            reload_response = page.reload(wait_until="networkidle")
            verify_r9_trace_navigation(native_capture,reload_response)
            select_save(page)
            capture_reload_evidence(page,row['name'],source_raw,committed_raw,phase='after',observer=reload_observer)
            check("native reload preserves exact original backup bytes", raw(page,BACKUP)==source_raw)
            manual_after = len(native_capture['trace'].events) - 1
            page.locator('[data-action="save"]').click()
            complete_r9_native_replay(page,native_capture,source_raw,committed_raw,row['name'],manual_after)
            check("native reload preserves the complete old building template library", exact_json(json.loads(raw(page))["state"]["buildingTemplates"], source["buildingTemplates"]))
            context.close()
            active_native_trace = None

        classification = "HTTP / native Storage / actual r9 complete-world source / injected migration fault"
        for fault in ({"operation": "write", "target": "backup", "mode": "throw"},
                      {"operation": "write", "target": "backup", "mode": "drop"},
                      {"operation": "write", "target": "current", "mode": "throw"},
                      {"operation": "write", "target": "current", "mode": "drop"},
                      {"operation": "read", "target": "backup", "afterWrite": True},
                      {"operation": "read", "target": "current", "afterWrite": True}):
            case = "actual r9 complete-world migration fault: " + json.dumps(fault, sort_keys=True)
            source_row = next(row for row in r9["rows"] if row["name"] == "complete_world_outbound")
            source_file = json.loads(source_row["raw"])
            source_file["savedAt"] = source_file["lastTickAt"] = int(time.time() * 1000) + 60_000
            source_raw = json.dumps(source_file, ensure_ascii=False, indent=2)
            context, page = boot(source_raw, startup_fault=fault)
            expect(page.locator('[data-bind="notice"]')).to_contain_text("原件已保留")
            frozen_time, frozen_metal = page.locator('[data-bind="played"]').text_content(), page.locator('[data-bind="amount-metal"]').text_content()
            page.wait_for_timeout(1_200)
            check("failed r9 migration freezes readable simulation and resources", page.locator('[data-bind="played"]').text_content() == frozen_time and page.locator('[data-bind="amount-metal"]').text_content() == frozen_metal)
            check("failed r9 migration retains its actual old planet", planet(page) == name_of(source_raw))
            check("failed r9 migration exports every original byte", download_raw(page, f"r9-{fault['operation']}-{fault['target']}-{fault.get('mode', 'readback')}-original.json") == source_raw)
            expected_event = "read-throw" if fault["operation"] == "read" else "write-" + fault["mode"]
            check("r9 failure actually exercised the requested fault", any(event["operation"] == expected_event and event.get("injected") for event in events(page)))
            persisted = page.evaluate("key => window.__saveNativeRead(key)", KEY)
            uncertain_write = fault["operation"] == "read" and fault["target"] == "current"
            if uncertain_write:
                check("uncertain r9 commit remains on disk without pretending it rolled back", json.loads(persisted)["revision"] == CURRENT_REVISION)
            else:
                check("denied or dropped r9 replacement keeps exact old current bytes", persisted == source_raw)
            check("failed r9 migration never announces success", not any(event["operation"] == "ui-status" and event["text"] == "已升级并保存本地存档" for event in events(page)))
            capture_audit(page, "actual r9 migration fault and exact original export")
            page.evaluate("window.__saveFault = null"); clear_audit(page)
            page.locator('[data-action="save"]').click()
            check("removing a r9 storage fault does not silently unfreeze or recover writes", not any(event["operation"] == "write-attempt" for event in events(page)))
            capture_audit(page, "actual r9 complete world remains protected")
            context.close()

        classification = "HTTP / native Storage / actual r8 source / injected migration fault"
        for fault in ({"operation": "write", "target": "backup", "mode": "throw"},
                      {"operation": "write", "target": "backup", "mode": "drop"},
                      {"operation": "write", "target": "current", "mode": "throw"},
                      {"operation": "write", "target": "current", "mode": "drop"},
                      {"operation": "read", "target": "backup", "afterWrite": True},
                      {"operation": "read", "target": "current", "afterWrite": True}):
            case = "actual r8 paid transport source migration fault: " + json.dumps(fault, sort_keys=True)
            r8_value = copy.deepcopy(fixtures["transportR8"]["outbound"])
            r8_value["savedAt"] = r8_value["lastTickAt"] = int(time.time() * 1000) + 60_000
            r8_raw = json.dumps(r8_value, ensure_ascii=False, indent=2)
            context, page = boot(r8_raw, startup_fault=fault)
            expect(page.locator('[data-bind="notice"]')).to_contain_text("原件已保留")
            frozen_time, frozen_metal = page.locator('[data-bind="played"]').text_content(), page.locator('[data-bind="amount-metal"]').text_content()
            page.wait_for_timeout(1_200)
            check("failed r8 migration freezes readable simulation", page.locator('[data-bind="played"]').text_content() == frozen_time and page.locator('[data-bind="amount-metal"]').text_content() == frozen_metal)
            check("failed r8 migration keeps the readable original planet", planet(page) == name_of(r8_raw))
            check("failed r8 migration exports the exact original despite readback failure", download_raw(page, f"r8-{fault['operation']}-{fault['target']}-{fault.get('mode', 'readback')}-original.json") == r8_raw)
            expected_event = "read-throw" if fault["operation"] == "read" else "write-" + fault["mode"]
            check("r8 source fault was actually exercised", any(row["operation"] == expected_event and row.get("injected") for row in events(page)))
            persisted = page.evaluate("key => window.__saveNativeRead(key)", KEY)
            uncertain_write = fault["operation"] == "read" and fault["target"] == "current"
            if uncertain_write:
                check("uncertain r8 write remains on disk without a false rollback claim", json.loads(persisted)["revision"] == SAVE_REVISION)
            else:
                check("r8 original bytes survive denied or dropped replacement", persisted == r8_raw)
            check("r8 failed migration never announces success", not any(row["operation"] == "ui-status" and row["text"] == "已升级并保存本地存档" for row in events(page)))
            capture_audit(page, "actual r8 migration fault and exact protected export")
            page.evaluate("window.__saveFault = null")
            clear_audit(page)
            page.locator('[data-action="save"]').click()
            check("r8 failure cannot silently unlock writes after fault is removed", not any(row["operation"] == "write-attempt" for row in events(page)))
            capture_audit(page, "actual r8 source remains protected")
            context.close()


        classification = "HTTP / native Storage backing / injected startup migration write fault"
        for revision in (2, 3, 4, 5, 6, 7, 8, 9, 10, 11):
            for target, fault_mode in (("all", "throw"), ("backup", "drop"), ("current", "throw"), ("current", "drop")):
                case = f"r{revision} startup migration fault: {target} {fault_mode}"
                legacy_raw = legacy_fixture(revision)
                context, page = boot(legacy_raw, startup_fault={
                    "operation": "write", "target": target, "mode": fault_mode})
                check(f"initial write denial does not hide readable r{revision} source", planet(page) == name_of(legacy_raw))
                check(f"failed startup migration preserves exact r{revision} current bytes", raw(page) == legacy_raw)
                expect(page.locator('[data-bind="notice"]')).to_contain_text("原件已保留")
                fault_key = KEY if target == "current" else BACKUP
                check("startup write fault was actually exercised", any(
                    row["operation"] == "write-" + fault_mode and row.get("key") == fault_key
                    and row.get("injected") for row in events(page)))
                if target == "current":
                    check("failed current replacement retains exact backup", raw(page, BACKUP) == legacy_raw)
                else:
                    check("failed startup backup never attempts a current write", not any(
                        row["operation"] == "write-attempt" and row["key"] == KEY for row in events(page)))
                frozen_time = page.locator('[data-bind="played"]').text_content()
                frozen_metal = page.locator('[data-bind="amount-metal"]').text_content()
                page.wait_for_timeout(1_200)
                check(f"readable r{revision} source simulation time remains frozen", page.locator('[data-bind="played"]').text_content() == frozen_time)
                check(f"readable r{revision} source resources remain frozen", page.locator('[data-bind="amount-metal"]').text_content() == frozen_metal)
                page.locator('[data-tab="overview"]').click()
                page.locator('[data-bind="action-scrape-ov"]').click()
                check(f"protected r{revision} source also rejects manual collection", page.locator('[data-bind="amount-metal"]').text_content() == frozen_metal)
                select_save(page)
                exported = download_raw(page, f"r{revision}-startup-{target}-{fault_mode}-original.json")
                check(f"failed startup migration exports exact original r{revision} bytes", exported == legacy_raw)
                check("failed startup migration never claims success", not any(
                    row["operation"] == "ui-status" and row["text"] == "已升级并保存本地存档"
                    for row in events(page)))
                capture_audit(page, "startup migration fault retains readable frozen source")
                context.close()

        classification = "HTTP / native Storage backing / injected write fault"
        for action in ("import", "reset"):
            for target in ("backup", "current"):
                for fault_mode in ("throw", "drop"):
                    case = f"fault-injected {action}: {target} {fault_mode}"
                    original, incoming = raw_fixture(), raw_fixture("imported")
                    context, page = boot(original)
                    clear_audit(page)
                    page.evaluate("fault => { window.__saveFault = fault }",
                                  {"operation": "write", "target": target, "mode": fault_mode})
                    if action == "import":
                        import_text(page, incoming)
                    else:
                        reset(page, True)
                    expect(page.locator('[data-bind="status"]')).to_contain_text("失败")
                    assert_no_replacement(page, original, name_of(original))
                    rows = events(page)
                    check("specified write fault was actually exercised", any(
                        row["operation"] == "write-" + fault_mode and row.get("injected")
                        for row in rows))
                    if target == "backup":
                        check("failed backup prevents any current write attempt", not any(
                            row["operation"] == "write-attempt" and row["key"] == KEY for row in rows))
                    else:
                        check("current failure still retains verified original backup", raw(page, BACKUP) == original)
                    if fault_mode == "drop":
                        check("silent write failure was detected by readback", any(
                            row["operation"] == "read" and
                            (row["key"] == KEY if target == "current" else row["key"].startswith(BACKUP))
                            for row in rows[next(i for i, row in enumerate(rows) if row["operation"] == "write-drop") + 1:]))
                    page.evaluate("window.__saveFault = null")
                    page.locator('[data-action="save"]').click()
                    check("clearing fault does not silently unlock ordinary save", raw(page) == original)
                    capture_audit(page, "failed replacement remains protected")
                    context.close()

        classification = "HTTP / native Storage backing / injected read fault"
        case = "fault-injected cached export during storage read denial"
        original = "{synthetic-corrupt-original\n"
        context, page = boot(original)
        page.evaluate("window.__saveFault = {operation: 'read', target: 'current'}")
        exported = download_raw(page, "cached-protected-original.json")
        check("protected export works from cached bytes while reads fail", exported == original)
        page.evaluate("window.__saveFault = null")
        check("cached export did not replace corrupt original", raw(page) == original)
        context.close()

        classification = "HTTP / native localStorage / actual shared-context browser tabs"
        case = "two browser tabs stop stale writes"
        original, incoming = raw_fixture(), raw_fixture("imported")
        context, first = boot(original)
        second = context.new_page()
        active_page = second
        attach_page(second)
        response = second.goto(args.url, wait_until="networkidle")
        check("second actual browser tab served over HTTP", response is not None and response.status == 200)
        select_save(second)
        check("both tabs display the original planet", planet(first) == planet(second) == name_of(original))
        original_shared = raw(second)
        clear_audit(first)
        clear_audit(second)
        import_text(second, incoming)
        committed = verify_commit(second, original_shared, "已导入并存入本地")
        expect(first.locator('[data-bind="notice"]')).to_contain_text("其他标签页")
        check("browser emitted a trusted native storage event", any(
            row["operation"] == "storage-event" and row.get("trusted") is True
            and row["key"] == KEY for row in events(first)))
        first.locator('[data-action="save"]').click()
        check("stale first tab cannot overwrite second tab's committed state", raw(second) == committed)
        reset(first, True)
        check("stale first tab cannot reset over another tab", raw(second) == committed)
        check("stale first tab keeps its original in-memory planet", planet(first) == name_of(original))
        exported = download_raw(first, "conflicted-tab-original.json")
        check("conflicted tab exports its own preserved original", exported == original_shared)
        check("conflict recovery controls never write to current slot", not any(
            row["operation"] == "write-attempt" and row["key"] == KEY for row in events(first)))
        screenshot(first, "two-tabs-conflict.png")
        capture_audit(first, "trusted storage event and blocked stale actions")
        with first.expect_event("close"):
            first.close(run_before_unload=True)
        check("closing conflicted tab does not overwrite current save", raw(second) == committed)
        context.close()

        classification = "HTTP / native localStorage / actual r6 source / trusted cross-tab conflict"
        case = "actual r6 migrated transport source remains protected against competing-tab replacement"
        r6_value = copy.deepcopy(fixtures["transportR6"]["outbound"])
        r6_value["savedAt"] = r6_value["lastTickAt"] = int(time.time() * 1000) + 60_000
        r6_raw = json.dumps(r6_value, ensure_ascii=False, indent=2)
        context, first = boot(r6_raw)
        first_baseline = verify_commit(first, r6_raw, "已升级并保存本地存档")
        second = context.new_page()
        active_page = second
        attach_page(second)
        second.goto(args.url, wait_until="networkidle")
        select_save(second)
        clear_audit(first)
        clear_audit(second)
        import_text(second, raw_fixture("imported"))
        committed = verify_commit(second, first_baseline, "已导入并存入本地")
        expect(first.locator('[data-bind="notice"]')).to_contain_text("其他标签页")
        check("actual r6 migrated page receives a trusted conflict event", any(row["operation"] == "storage-event" and row.get("trusted") for row in events(first)))
        first.locator('[data-action="save"]').click()
        reset(first, True)
        check("stale migrated-r6 tab cannot overwrite competing current bytes", raw(second) == committed)
        check("stale migrated-r6 tab exports its exact transport-bearing baseline", download_raw(first, "r6-conflicted-tab-original.json") == first_baseline)
        check("r6 original migration backup remains immutable across conflict", raw(second, BACKUP) == r6_raw)
        check("stale migrated-r6 controls cannot attempt a current write", not any(row["operation"] == "write-attempt" and row["key"] == KEY for row in events(first)))
        context.close()

        classification = "HTTP / native localStorage"
        case = "reset cancellation and successful durable replacement"
        original = raw_fixture()
        # An existing backup must remain immutable; reset should use .backup.1.
        prior_backup = "SYNTHETIC PRE-EXISTING BACKUP\n"
        context, page = boot(original, {BACKUP: prior_backup})
        clear_audit(page)
        reset(page, False)
        assert_no_replacement(page, original, name_of(original))
        check("canceling reset performs no writes", not any(
            row["operation"] == "write-attempt" for row in events(page)))
        clear_audit(page)
        reset(page, True)
        reset_raw = verify_commit(page, original, "已重置并存入本地")
        check("reset changes the displayed planet to a fresh game", planet(page) != name_of(original))
        reset_state = json.loads(reset_raw)["state"]
        check("reset commits an empty research intent library", reset_state["researchTemplates"] == {"nextTemplateId": 1, "templates": []})
        check("reset commits an empty fleet formation library", reset_state["formations"] == {"nextFormationId": 1, "entries": []})
        check("reset commits a single fresh planet", len(reset_state["planets"]) == 1)
        check("reset commits empty progress", reset_state["manualClicks"] == 0 and
              all(level == 0 for level in reset_state["planets"][0]["buildings"].values()))
        check("pre-existing backup is never overwritten", raw(page, BACKUP) == prior_backup)
        check("reset preserves current bytes in the next immutable backup", raw(page, BACKUP + ".1") == original)
        check("successful reset clears transfer text", page.locator('[data-bind="transfer"]').input_value() == "")
        screenshot(page, "reset-committed.png")
        page.reload(wait_until="networkidle")
        select_save(page)
        check("native reload restores committed reset", planet(page) == name_of(reset_raw))
        context.close()

        classification = "HTTP / native Storage and File backing / controlled async read timing"
        for newer_action in ("text import", "reset", "manual collection"):
            case = "async file import superseded by " + newer_action
            original, incoming, newer = raw_fixture(), raw_fixture("imported"), raw_fixture("newer")
            context, page = boot(original)
            page.evaluate("""() => {
                const nativeText = File.prototype.text;
                window.__pendingFileRead = null;
                File.prototype.text = function() {
                    return new Promise((resolve, reject) => {
                        nativeText.call(this).then(text => {
                            window.__pendingFileRead = {release: () => resolve(text)};
                        }, reject);
                    });
                };
            }""")
            before_confirmations = confirmation_count(page)
            page.locator('[data-bind="import-file"]').set_input_files(
                {"name": "synthetic-delayed.json", "mimeType": "application/json", "buffer": incoming.encode()})
            page.wait_for_function("window.__pendingFileRead !== null")
            check("pending file never asks for confirmation before native read completes", confirmation_count(page) == before_confirmations)
            if newer_action == "text import":
                import_text(page, newer)
                expect(page.locator('[data-bind="status"]')).to_have_text("已导入并存入本地")
            elif newer_action == "reset":
                reset(page, True)
                expect(page.locator('[data-bind="status"]')).to_have_text("已重置并存入本地")
            else:
                page.locator('[data-tab="overview"]').click()
                page.locator('[data-bind="action-scrape-ov"]').click()
                select_save(page)
            newest_raw, newest_planet = raw(page), planet(page)
            newest_status = status(page)
            newest_transfer = page.locator('[data-bind="transfer"]').input_value()
            clear_audit(page)
            before_release_confirmations = confirmation_count(page)
            page.evaluate("window.__pendingFileRead.release()")
            # Run the native microtask/animation-frame chain, without a fake game clock.
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            check("retired file completion never adds a replacement confirmation", confirmation_count(page) == before_release_confirmations)
            check("only an explicit newer reset asks for confirmation", confirmation_count(page) == before_confirmations + (1 if newer_action == "reset" else 0))
            check("stale completed file read cannot overwrite newer storage", raw(page) == newest_raw)
            check("stale completed file read cannot replace newer live state", planet(page) == newest_planet)
            check("stale completed file read cannot overwrite newer status", status(page) == newest_status)
            check("stale completed file read cannot overwrite newer transfer text",
                  page.locator('[data-bind="transfer"]').input_value() == newest_transfer)
            check("stale file completion never attempts a current or backup write", not any(
                row["operation"] == "write-attempt" for row in events(page)))
            if newer_action == "manual collection":
                page.locator('[data-action="save"]').click()
                check("manual progress survived delayed import", json.loads(raw(page))["state"]["manualClicks"] == 1)
            capture_audit(page, "superseded native file read")
            context.close()

        case = "async failed read completion cannot replace newer success status"
        original, newer = raw_fixture(), raw_fixture("newer")
        context, page = boot(original)
        page.evaluate("""() => {
            const nativeText = File.prototype.text;
            window.__pendingFileRead = null;
            File.prototype.text = function() {
                return new Promise((resolve, reject) => {
                    nativeText.call(this).then(text => {
                        window.__pendingFileRead = {release: () => resolve(text)};
                    }, reject);
                });
            };
        }""")
        before_confirmations = confirmation_count(page)
        page.locator('[data-bind="import-file"]').set_input_files(
            {"name": "synthetic-invalid-delayed.json", "mimeType": "application/json", "buffer": b"{invalid-json"})
        page.wait_for_function("window.__pendingFileRead !== null")
        page.locator('[data-bind="transfer"]').fill(newer)
        clear_audit(page)
        # Resolve invalid File.text first. Its parsing continuation is queued before
        # this click, while main.ts's await continuation is queued after the click.
        # This exercises an obsolete FAILURE result, not merely an obsolete read.
        page.evaluate("""() => {
            window.__pendingFileRead.release();
            queueMicrotask(() => document.querySelector('[data-action="import-text"]').click());
        }""")
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        check("obsolete failed file and newer text import never ask for confirmation", confirmation_count(page) == before_confirmations)
        check("newer import's success status survives obsolete file failure", status(page) == "已导入并存入本地")
        committed = verify_commit(page, original, "已导入并存入本地")
        check("newer successful file remains durable", name_of(committed) == name_of(newer))
        check("newer live state survives obsolete file failure", planet(page) == name_of(newer))
        check("obsolete failed file did not emit a later failure status", not any(
            row["operation"] == "ui-status" and "导入失败" in row["text"] for row in events(page)))
        context.close()

        case = "suite integrity"
        check("no uncaught JavaScript errors", not errors)
        check("no failed production resource requests", not failed_requests)
        completed = True
        browser.close()
        browser = None
finally:
    report = {"completed": completed, "url": args.url,
              "mode": "HTTP production bundle / native localStorage; no inline fallback",
              "fixture": fixtures.get("description"),
              "scope": "Single browser origin; observed cross-tab conflicts, not atomic localStorage CAS",
              "faultInjection": "Explicitly labeled Storage.prototype throw/drop cases; native backing retained",
              "asyncTiming": "Explicitly labeled delayed native File.text results; real simulation clock",
              "passed": sum(row["passed"] for row in checks), "checks": checks,
              "errors": errors, "failedRequests": failed_requests, "audits": audit_reports, "failure": failure}
    (out / "save-session-browser-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({"completed": completed, "passed": report["passed"], "total": len(checks),
                      "failedCase": None if completed else case, "errors": errors}, ensure_ascii=False))
