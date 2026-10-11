"""Native IRN continuation against the SHA-pinned HTTP production release.

Unchanged report milestones enter only through native file selection/read/confirm.
Actual UI pays IRN1 and creates a budgeted finite computer11 plan, then original
production and one-second live ticks fund and finish it. A second canonical
06->10 handoff replay remains separate from the immediate-at-05 intent branch.
Only the labeled saved-duration compatibility probe is synthetic. Date,
performance and RAF timestamps are simulated; native timers, storage, File.text,
confirmation, wheel, keyboard and clicks are not replaced. No browser hooks
modify app state. Full-state engine oracles supplement independent literals.
"""
import argparse
import copy
import hashlib
import json
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


def atomic_json(path, value):
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture', default='research-network-review-save.json')
parser.add_argument('--natural-report', default='natural-research-network-report.json')
parser.add_argument('--expected-report-sha256', required=True)
parser.add_argument('--release')
parser.add_argument('--output', default='research-network-evidence')
parser.add_argument('--chromium')
parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA'))
parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()
if not args.expected_sha or not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha):
    parser.error('--expected-sha (or GITHUB_SHA) must pin the exact 40-character commit')
if not re.fullmatch(r'[0-9a-f]{64}', args.expected_report_sha256):
    parser.error('--expected-report-sha256 must independently pin the complete natural report')
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
report_path = out / 'research-network-browser-report.json'
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
        deadline = time.monotonic() + 245
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
    report = json.loads(report_path.read_text())
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
KEY, HOME, COLONY = fixtures['key'], fixtures['homeId'], fixtures['colonyId']
RESOURCES = ('metal', 'crystal', 'deuterium')
parsed = urlparse(args.url)
if parsed.scheme not in ('http', 'https'):
    raise ValueError('Acceptance requires actual HTTP(S) production URL')
ORIGIN = f'{parsed.scheme}://{parsed.netloc}'
checks, errors, failed_requests, evidence, source_bindings = [], [], [], [], []
page_sources, release_metadata = {}, None
completed, active_page, source_sha, failure = False, None, None, None
case = 'setup'
branch_metrics = {}
IRN = 'intergalactic_research_network'
COMPUTER = 'computer_tech'
CARD = '[data-bind="rcard-computer_tech"]'
IRN_CARD = '[data-bind="rcard-intergalactic_research_network"]'
PAY = '[data-action="research"][data-id="intergalactic_research_network"]'
QUEUE = '[data-bind="rqueue-list"]'
GOLD_IRN = {'metal': '240000', 'crystal': '400000', 'deuterium': '160000'}
GOLD_COMPUTER = {'metal': '0', 'crystal': '409600', 'deuterium': '614400'}

CLOCK = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const raf=window.requestAnimationFrame.bind(window);
 const saved=sessionStorage.getItem('research-network-clock');
 const epoch=saved?Number(saved):__EPOCH__;let elapsed=0;
 Date.now=()=>epoch+elapsed;Object.defineProperty(performance,'now',{value:()=>elapsed});
 window.requestAnimationFrame=callback=>raf(()=>callback(elapsed));
 window.__irnAdvance=async ms=>{const beforeAt=epoch+elapsed;elapsed+=ms;sessionStorage.setItem('research-network-clock',String(epoch+elapsed));await new Promise(raf);await new Promise(raf);return{beforeAt,afterAt:epoch+elapsed};};
 window.__irnNative=[Storage.prototype.getItem,Storage.prototype.setItem,File.prototype.text,window.confirm,window.setTimeout,window.setInterval].every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn)));
 window.__irnClicks=[];window.__irnEdits=[];window.__irnFiles=[];window.__irnWheels=[];window.__irnStorage=[];
 document.addEventListener('click',event=>{const b=event.target.closest?.('button');if(b)window.__irnClicks.push({action:b.dataset.action||b.dataset.orderAction||b.dataset.buildingTemplateAction||b.dataset.tab,id:b.dataset.id||b.id,trusted:event.isTrusted});},true);
 for(const type of ['input','change'])document.addEventListener(type,event=>{if(event.target.matches?.('select,input'))window.__irnEdits.push({id:event.target.id,type,trusted:event.isTrusted,value:event.target.value});},true);
 document.addEventListener('wheel',event=>window.__irnWheels.push({trusted:event.isTrusted,deltaY:event.deltaY}),{capture:true,passive:true});
 document.addEventListener('change',event=>{if(event.target.matches?.('[data-bind="import-file"]'))window.__irnFiles.push({trusted:event.isTrusted,name:event.target.files[0]?.name,size:event.target.files[0]?.size,priorRaw:localStorage.getItem(__KEY__)});},true);
 window.addEventListener('storage',event=>{if(event.storageArea===localStorage&&event.key===__KEY__)window.__irnStorage.push({trusted:event.isTrusted,oldValue:event.oldValue,newValue:event.newValue});});
})();'''.replace('__ORIGIN__', json.dumps(ORIGIN)).replace('__KEY__', json.dumps(KEY))

def begin_case(label):
    global case
    now = time.monotonic()
    if case in branch_metrics:
        branch_metrics[case]['_hostEnded'] = now
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
        'mode': 'Date/performance/RAF timestamps simulated. Positive advances are 1000ms and original live tick runs; native timers remain unchanged. Imported envelopes retain their original clocks; reload has zero saved gap.',
        'successfulAdvanceCalls': sum(row['successfulAdvanceCalls'] for row in branches),
        'zeroAdvanceCalls': sum(row['zeroAdvanceCalls'] for row in branches),
        'liveOneSecondAdvanceCalls': sum(row['liveOneSecondAdvanceCalls'] for row in branches),
        'simulatedSeconds': sum(row['simulatedSeconds'] for row in branches), 'branches': branches,
        'uncertainty': 'An unfinished advance remains advanceInFlight and is not counted as observed simulated time.'}


def flush():
    atomic_json(report_path, {'completed': completed, 'result': 'passed' if completed else 'incomplete',
        'case': case, 'url': args.url, 'sourceSha': source_sha, 'fixture': fixtures['description'],
        'fixtureSha256': fixture_sha256,
        'fixtureHashBinding': 'SHA256 of the immutable initially loaded fixture bytes parsed into this run; no later disk reread is used as its identity.',
        'sourceReportSha256': fixtures['source']['reportSha256'],
        'classification': 'Unchanged natural 03 and 06 handoffs. Actual UI IRN payment reaches 04/05. Immediate-at-05 finite UI intent branch is separate from canonical 06->10. Labeled synthetic saved-duration compatibility is never natural evidence.',
        'responsiveScope': '320/390/768/1440: actual per-tech text bodies, action-button text and hit tests, native wheel/navigation and viewport screenshots. Economic execution is at 1440 only.',
        'timing': timing_report(),
        'oracle': 'All serialized state fields, no exclusions. Separate literal costs, duration, job identity, task ledger and Number wallet arithmetic checks.',
        'boundsSeconds': {'worker': 240, 'supervisor': 245}, 'checks': checks,
        'passed': sum(value['passed'] for value in checks), 'errors': errors, 'failedRequests': failed_requests,
        'sourceBindings': source_bindings, 'evidence': evidence, 'failure': failure})


def research_tab(page):
    tab(page, 'research'); expect(page.locator(CARD)).to_be_visible()


def save(page, expected=None):
    tab(page, 'save'); page.locator('[data-action="save"]').click(); result = read(page); research_tab(page)
    if expected:
        whole_state(expected, result, fixtures['expected'][expected])
    return result


def boot(epoch, width=1440):
    global active_page
    values = [{'name': 'infinity.ui.tab', 'value': 'overview'},
              {'name': 'infinity.save.v1', 'value': 'EXPLICIT LEGACY SENTINEL: retain unchanged'}]
    context = browser.new_context(viewport={'width': width, 'height': 1100}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{'origin': ORIGIN, 'localStorage': values}]})
    context.add_init_script(CLOCK.replace('__EPOCH__', str(epoch)))
    page = context.new_page(); active_page = page; attach(page)
    response = page.goto(args.url, wait_until='networkidle')
    check('production page is actual HTTP 200', response is not None and response.status == 200 and response.url == args.url)
    verify_bundle(page); verify_document_response(response)
    check('Storage, File.text, confirm and timer functions remain native', page.evaluate('window.__irnNative'))
    return context, page


def import_save(page, value, label):
    check('unchanged handoff envelope is imported at its exact zero-gap clock', value['savedAt'] == value['lastTickAt'] == page.evaluate('Date.now()'))
    path = out / f'native-import-{label}.json'
    path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    tab(page, 'save'); page.locator('[data-action="save"]').click()
    before, count, dialogs = raw(page), page.evaluate('window.__irnFiles.length'), []
    current = read(page)
    active = planet(current, current['activePlanetId'])
    progress = f'第 {current["stats"]["launches"] + 1} 轮，{len(current["planets"])} 颗星球，当前“{active["name"]}”'
    def answer(dialog):
        valid = dialog.type == 'confirm' and dialog.message.startswith(f'已读取存档 v{value["version"]}/r{value["revision"]}。') and f'是否替换当前进度（{progress}）？' in dialog.message and '读取期间产生的变化也会被替换' in dialog.message and '写入校验成功后才采用' in dialog.message
        dialogs.append({'valid': valid, 'message': dialog.message}); dialog.accept() if valid else dialog.dismiss()
    page.once('dialog', answer)
    page.locator('[data-bind="import-file"]').set_input_files(str(path.resolve()))
    expect(page.locator('[data-bind="status"]')).to_contain_text('已导入并存入本地')
    files = page.evaluate('window.__irnFiles')
    check('native File selection/read followed by one explicit native confirmation', len(dialogs) == 1 and dialogs[0]['valid'] and len(files) == count + 1 and files[-1] == {'trusted': True, 'name': path.name, 'size': path.stat().st_size, 'priorRaw': before})
    check('entire native imported envelope equals unchanged handoff', exact_json(json.loads(raw(page)), value))
    evidence.append({'case': case, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'classification': label, 'nativeConfirmation': dialogs})
    research_tab(page); whole_state('import-' + label, read(page), value['state'])


def handoff(page, key):
    import_save(page, fixtures['naturalMilestones'][key]['save'], 'unchanged-natural-' + key)


def reload_verified(page, expected):
    saved = json.loads(raw(page)); job = copy.deepcopy(saved['state']['research']['queue'])
    check('cold reload begins at exact saved zero-gap clock', saved['savedAt'] == saved['lastTickAt'] == page.evaluate('Date.now()'))
    capture = page_sources[page]; capture['cdp'].send('Debugger.enable'); capture['responses'].clear(); capture['executed'].clear()
    response = page.reload(wait_until='networkidle')
    check('native reload gets fresh actual HTTP 200', response is not None and response.status == 200 and response.url == args.url)
    verify_bundle(page); verify_document_response(response); research_tab(page); restored = save(page, expected)
    check('reload preserves every paid identity and exact saved total/remaining seconds', restored['research']['queue'] == job)


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


def responsive(page):
    # Separate text leaves are tested, not just an outer card bounding box.
    selectors = [CARD + ' h3', '[data-bind="rtime-computer_tech"]', '[data-bind="rlater-computer_tech"]',
                 '[data-bind="research-computer_tech"]', IRN_CARD + ' h3', '[data-bind="rtime-intergalactic_research_network"]',
                 '[data-bind="reffect-intergalactic_research_network"]', '[data-bind="research-intergalactic_research_network"]']
    for width in (320, 390, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 1100})
        count = page.evaluate('window.__irnClicks.length')
        page.locator('[data-tab="research"]').click(); advance(page)
        clicks = page.evaluate('(n)=>window.__irnClicks.slice(n)', count)
        check(f'{width}px native research navigation is trusted', len(clicks) == 1 and clicks[0]['trusted'] and clicks[0]['action'] == 'research')
        page.mouse.move(width - 12, 1080); page.mouse.wheel(0, -100000); page.wait_for_timeout(80); advance(page)
        for index, selector in enumerate(selectors):
            native_scroll_to(page, selector); visible = visibility(page, [selector])
            check(f'{width}px actual card text/control {index} is fully visible and five-point hit-tested', all(t['visible'] and t['contained'] and t['text'].strip() and all(p['unoccluded'] for p in t['points']) for t in visible['targets']), visible)
            leaf_selectors = [selector]
            if index in (3, 7):
                tech = COMPUTER if index == 3 else IRN
                leaf_selectors = [f'[data-bind="rbutton-{tech}"]', f'[data-bind="rreason-{tech}"]']
            leaf_proof = text_leaf_visibility(page, leaf_selectors)
            check(f'{width}px every actual text glyph fits the viewport and all clip ancestors',
                  all(leaf['passed'] for leaf in leaf_proof['leaves']), leaf_proof)
            # Both button boxes retain their independent five-point hit tests;
            # each label/reason text leaf additionally has glyph/ancestor proof.
            if index in (2, 3, 6, 7):
                snap(page, f'research-network-{width}-{index}.png')
            after = visibility(page, [selector]); leaves_after = text_leaf_visibility(page, leaf_selectors)
            check('screenshot/inspection preserves exact button geometry and unclipped text', after == visible and leaves_after == leaf_proof)
            atomic_json(out / f'research-network-{width}-{index}-visibility.json',
                        {'target': visible, 'textLeaves': leaf_proof, 'afterTextLeaves': leaves_after})
        check(f'{width}px no horizontal document overflow', page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    wheels = page.evaluate('window.__irnWheels')
    check('responsive inspection used real trusted wheel input', bool(wheels) and all(e['trusted'] for e in wheels) and any(e['deltaY'] > 0 for e in wheels))
    page.set_viewport_size({'width': 1440, 'height': 1100})


def expected_blurbs(page, home=True):
    expected = '当前实验室：主 10 + 协作 3 = 13 级' if home else '当前实验室：主 3 + 协作 10 = 13 级'
    check('computer per-tech full-width blurb shows actual primary plus eligible support', expected in page.locator('[data-bind="rlater-computer_tech"]').inner_text())
    check('lab3 never contributes to IRN own required lab10 quote', '协作' not in page.locator('[data-bind="rlater-intergalactic_research_network"]').inner_text())


def payment_golden(before, after, tech, source, amount, seconds, production=None):
    job = after['research']['queue'][0]
    check('literal paid cost, old nextJobId, owner, target, source and positive timer', job['paid'] == amount and job['jobId'] == before['orders']['nextJobId'] and job['planetId'] == HOME and job['tech'] == tech and job['targetLevel'] == (1 if tech == IRN else 11) and job['source'] == source and abs(job['totalSeconds'] - seconds) < 1e-10 and job['remainingSeconds'] > 0, job)
    for old in before['planets']:
        new = planet(after, old['id'])
        proof = next((p for p in production or [] if p['planetId'] == old['id']), None)
        for resource in RESOURCES:
            balance = float(old['resources'][resource])
            expected = (min(proof['caps'][resource], balance + proof['net'][resource]) if proof else balance) - (float(amount[resource]) if old['id'] == HOME else 0)
            actual = float(new['resources'][resource])
            check('independent bounded Number wallet production/debit: ' + old['id'] + '/' + resource, abs(actual - expected) <= 1e-7 + abs(expected) * 2e-14, {'before': balance, 'actual': actual, 'expected': expected, 'productionSeconds': 1 if proof else 0})
    return job


def completed_golden(before, after, task_id):
    task = next(t for t in after['orders']['tasks'] if t['id'] == task_id)
    check('finite completion raises computer exactly once with exact budget/charge and no refunds', after['research']['levels'][COMPUTER] == 11 and not after['research']['queue'] and after['stats']['researchCompleted'] == before['stats']['researchCompleted'] + 1 and after['orders']['nextJobId'] == before['orders']['nextJobId'] and task['status'] == 'completed' and task['activeJob'] is None and task['budget'] == task['charged'] == GOLD_COMPUTER and task['refunded'] == {'metal': '0', 'crystal': '0', 'deuterium': '0'}, task)
    return task


def timeout(_signal, _frame):
    raise TimeoutError('IRN native acceptance exceeded the 240-second worker bound')

def check(name, condition, detail=None):
    checks.append({'case': case, 'name': name, 'passed': bool(condition), **({'detail': detail} if detail is not None else {})})
    flush()
    if not condition:
        raise AssertionError(f'{case}: {name}')

def advance(page, milliseconds=0):
    if milliseconds not in (0, 1000):
        raise ValueError('Acceptance only permits zero-time UI frames or exact one-second live advances')
    metrics = branch_metrics[case]
    metrics['attemptedAdvanceCalls'] += 1
    metrics['advanceInFlight'] = {'requestedMilliseconds': milliseconds,
        'hostStartOffsetSeconds': time.monotonic() - HOST_STARTED_MONOTONIC}
    observed = page.evaluate('(ms)=>window.__irnAdvance(ms)', milliseconds)
    if observed['afterAt'] - observed['beforeAt'] != milliseconds:
        raise AssertionError('Actual controlled clock delta differs from requested advance')
    metrics['successfulAdvanceCalls'] += 1
    metrics['zeroAdvanceCalls' if milliseconds == 0 else 'liveOneSecondAdvanceCalls'] += 1
    metrics['simulatedSeconds'] += (observed['afterAt'] - observed['beforeAt']) / 1000
    metrics['advanceInFlight'] = None

def tab(page, name):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()
    page.locator(f'[data-tab="{name}"]').click(); advance(page)

def raw(page):
    return page.evaluate('(key)=>localStorage.getItem(key)', KEY)

def storage(page):
    return page.evaluate('Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]))')

def read(page):
    return json.loads(raw(page))['state']

def planet(state, ident=HOME):
    return next(value for value in state['planets'] if value['id'] == ident)

def trusted_click(page, selector):
    native_scroll_to(page, selector)
    before = page.evaluate('window.__irnClicks.length'); page.locator(selector).click(); advance(page)
    events = page.evaluate('(n)=>window.__irnClicks.slice(n)', before)
    check('actual user input produces exactly one trusted button click', len(events) == 1 and events[0]['trusted'], events)

def type_value(page, selector, value):
    field = page.locator(selector); before = page.evaluate('window.__irnEdits.length')
    native_scroll_to(page, selector)
    field.focus(); field.press('ControlOrMeta+A'); field.press('Backspace'); field.press_sequentially(str(value)); field.press('Tab'); advance(page)
    events = page.evaluate('(n)=>window.__irnEdits.slice(n)', before)
    check('native keyboard enters exact value through trusted input', field.input_value() == str(value) and any(e['trusted'] and e['type'] == 'input' and e['id'] == (field.get_attribute('id') or '') for e in events), events)

def one_seconds(page, count):
    for _ in range(count):
        advance(page, 1000)

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


def select(page, selector, value):
    field = page.locator(selector); before = field.input_value()
    index = field.evaluate('(e,value)=>[...e.options].findIndex(option=>option.value===value)', value)
    check(selector + ': requested native option exists', index >= 0)
    count = page.evaluate('window.__irnEdits.length'); field.focus(); field.press('Home')
    for _ in range(index):
        field.press('ArrowDown')
    field.press('Tab'); advance(page)
    events = page.evaluate('(n)=>window.__irnEdits.slice(n)', count)
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
    check(name + ': every serialized game field equals production-engine oracle plus separate independent goldens', same,
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

def native_scroll_to(page, selector):
    for _ in range(5):
        box = page.locator(selector).bounding_box()
        limits = page.evaluate('({height:innerHeight,width:innerWidth,top:Math.max(0,document.querySelector(".topbar")?.getBoundingClientRect().bottom||0)+12})')
        available = limits['height'] - limits['top'] - 12
        check('target fits below actual sticky header', box is not None and box['height'] <= available, {'selector': selector, 'box': box, 'limits': limits})
        if box['y'] >= limits['top'] and box['y'] + box['height'] <= limits['height'] - 12:
            return
        target_y = limits['top'] + (available - box['height']) / 2
        page.mouse.move(limits['width'] - 12, limits['height'] - 12)
        page.mouse.wheel(0, round(box['y'] - target_y)); page.wait_for_timeout(100); advance(page)
    raise AssertionError('Actual wheel input could not expose the complete requested region')

signal.signal(signal.SIGALRM, timeout); signal.alarm(240)
begin_case('setup')
try:
    source_bytes = Path(args.natural_report).read_bytes(); source_report = json.loads(source_bytes)
    check('complete source report independently matches CLI and fixture hash', hashlib.sha256(source_bytes).hexdigest() == args.expected_report_sha256 == fixtures['source']['reportSha256'])
    check('formal native evidence is the clean independently pinned IRN source', fixtures['schema'] == 'infinity-research-network-browser-fixture-v1' and source_report['schema'] == 'infinity-natural-research-network-journey-v1' and source_report['outcome']['status'] == 'passed' and source_report['source']['sourceSha'] == source_report['source']['gitHead'] == fixtures['source']['sourceSha'] == args.expected_sha and source_report['source']['sourceScopeStatusPorcelain'] == fixtures['source']['sourceScopeStatusPorcelain'] == fixtures['source']['oracleSourceScopeStatusPorcelain'] == '' and source_report['provenance']['injectedGameState'] is False)
    check('all eight full milestone bodies are present and bound to source report', len(fixtures['naturalMilestones']) == 8)
    for key, milestone in fixtures['naturalMilestones'].items():
        matches = [m for m in source_report['milestones'] if m['name'] == milestone['name']]
        check('unchanged entire natural milestone body: ' + key, len(matches) == 1 and exact_json(matches[0], milestone) and milestone['strictRoundtrips'] == 2 and milestone['stateAdoptedFromReload'] and milestone['subsequentLiveTickObserved'])
    (out / 'source-natural-research-network-report.json').write_bytes(source_bytes)
    check('independent literal IRN and computer payment/duration constants', fixtures['golden']['irn1'] == GOLD_IRN and fixtures['golden']['computer11'] == GOLD_COMPUTER and abs(fixtures['golden']['irn1Seconds'] - 3840 / 11) < 1e-10 and abs(fixtures['golden']['computer11BeforeNetworkSeconds'] - 12288 / 55) < 1e-10 and abs(fixtures['golden']['computer11AfterNetworkSeconds'] - 6144 / 35) < 1e-10)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        begin_case('unchanged natural 03 -> actual production -> trusted manual IRN payment -> live reload -> actual 05')
        context, page = boot(fixtures['naturalMilestones']['before']['save']['savedAt'])
        handoff(page, 'before'); baseline = save(page, 'before')
        check('earned main10/colony3/hyperspace8 is present before completed IRN0', planet(baseline)['buildings']['research_lab'] == 10 and planet(baseline, COLONY)['buildings']['research_lab'] == 3 and baseline['research']['levels']['hyperspace_tech'] == 8 and baseline['research']['levels'][IRN] == 0)
        check('before-network ordinary computer11 card shows literal 224-second rounded quote and no support', page.locator('[data-bind="rtime-computer_tech"]').inner_text() == '研究时间 3 分 44 秒' and '协作' not in page.locator('[data-bind="rlater-computer_tech"]').inner_text())
        one_seconds(page, fixtures['execution']['irnWaitSeconds']); ready = save(page, 'irnReady')
        check('ordinary IRN button becomes affordable through original production', page.locator(PAY).is_enabled() and page.locator('[data-bind="rbutton-intergalactic_research_network"]').inner_text() == '研究 等级 1')
        trusted_click(page, PAY); irn_paid = save(page, 'irnPaid')
        job = payment_golden(ready, irn_paid, IRN, 'manual', GOLD_IRN, 3840 / 11)
        check('IRN cannot accelerate itself before its first completion', irn_paid['research']['levels'][IRN] == 0 and job['totalSeconds'] == job['remainingSeconds'] and page.locator(QUEUE + ' [data-q="detail"]').inner_text() == '剩余 5 分 50 秒 / 共 5 分 50 秒')
        record(page, 'actual-irn1-payment')
        advance(page, 1000); save(page, 'irnOneSecond'); record(page, 'irn1-before-native-reload')
        reload_verified(page, 'irnReloaded')
        one_seconds(page, fixtures['execution']['irnFinishAfterOneSecond']); network = save(page, 'network')
        check('IRN completed once with existing natural labs and no replacement payment', network['research']['levels'][IRN] == 1 and network['stats']['researchCompleted'] == irn_paid['stats']['researchCompleted'] + 1 and not network['research']['queue'] and network['orders']['nextJobId'] == irn_paid['orders']['nextJobId'])
        expected_blurbs(page)
        check('next computer11 is literal network13 rounded 176 seconds; IRN own next quote excludes lab3', page.locator('[data-bind="rtime-computer_tech"]').inner_text() == '研究时间 2 分 56 秒' and page.locator('[data-bind="rtime-intergalactic_research_network"]').inner_text() == '研究时间 11 分 39 秒')
        before_views = copy.deepcopy(network); responsive(page); whole_state('view-only-responsive-no-economic-authority', save(page), before_views)
        record(page, 'actual-irn1-completed-network13')

        begin_case('actual UI finite budget at natural 05 -> unpaid wait -> automatic fixed-mother payment while colony selected')
        tab(page, 'orders')
        select(page, '#order-kind', 'research'); select(page, '#order-target', COMPUTER)
        select(page, '#order-planet', HOME); type_value(page, '#order-goal', '11')
        check('all new finite budgets are zero and transport unauthorized by default', all(page.locator('#order-budget-' + r).input_value() == '0' for r in RESOURCES) and not page.locator('#order-transport-enabled').is_checked())
        for resource in RESOURCES:
            type_value(page, '#order-budget-' + resource, GOLD_COMPUTER[resource])
        before_draft = save(page, 'network')
        check('editing finite intent controls alone creates no authority or charge', before_draft['orders'] == network['orders'] and before_draft['research'] == network['research'] and before_draft['planets'] == network['planets'])
        tab(page, 'orders'); select(page, '#planet-select', COLONY); save(page, 'uiSelectedColony'); tab(page, 'orders')
        check('real global colony selection preserves explicitly chosen mother payer and exact finite budget', page.locator('#planet-select').input_value() == COLONY and page.locator('#order-planet').input_value() == HOME and {r: page.locator('#order-budget-' + r).input_value() for r in RESOURCES} == GOLD_COMPUTER)
        trusted_click(page, '#order-create'); intent = save(page, 'uiIntent'); tid = fixtures['execution']['taskId']
        task = next(t for t in intent['orders']['tasks'] if t['id'] == tid)
        check('actual finite intent adds one unpaid task with no hidden funding, paid identity or transport authority', intent['activePlanetId'] == COLONY and len(intent['orders']['tasks']) == len(network['orders']['tasks']) + 1 and intent['orders']['nextJobId'] == network['orders']['nextJobId'] and not intent['research']['queue'] and task['planetId'] == HOME and task['targetLevel'] == 11 and task['budget'] == GOLD_COMPUTER and task['charged'] == {'metal': '0', 'crystal': '0', 'deuterium': '0'} and task['transport'] is None and task['activeJob'] is None and intent['planets'] == network['planets'], task)
        one_seconds(page, 10); waiting = save(page, 'uiWaiting'); tab(page, 'orders')
        row = page.locator(f'[data-order-id="{tid}"]')
        check('finite plan visibly waits on real unfunded mother resources', row.locator('[data-order="reason"]').inner_text().startswith('缺 ') and '暂无已付款工作' in row.inner_text() and not waiting['research']['queue'])
        native_scroll_to(page, f'[data-order-id="{tid}"] [data-order="reason"]'); snap(page, 'native-finite-plan-resource-waiting.png')
        one_seconds(page, fixtures['execution']['fundingSeconds'] - 11); prepayment = save(page, 'uiBeforePayment')
        advance(page, 1000); paid_state = save(page, 'uiPaid')
        paid_job = payment_golden(prepayment, paid_state, COMPUTER, 'plan', GOLD_COMPUTER, 6144 / 35, fixtures['independentPaymentProofs']['uiPayment'])
        check('automatic first payment uses exact fixed mother task while colony remains selected', paid_state['activePlanetId'] == COLONY and paid_job['taskId'] == tid and paid_job['jobId'] == fixtures['execution']['uiJobId'] and paid_state['research']['levels'][COMPUTER] == 10)
        expected_blurbs(page, home=False)
        record(page, 'actual-ui-finite-first-payment')
        one_seconds(page, 5); inflight = save(page, 'uiFiveSeconds')
        check('real paid research remains in flight for native reload with frozen duration', inflight['research']['queue'][0]['jobId'] == paid_job['jobId'] and inflight['research']['queue'][0]['totalSeconds'] == paid_job['totalSeconds'] and abs(inflight['research']['queue'][0]['remainingSeconds'] - (6144 / 35 - 5)) < 1e-10)
        record(page, 'ui-finite-inflight-before-reload'); reload_verified(page, 'uiReloaded')
        one_seconds(page, fixtures['execution']['uiFinishAfterFiveSeconds']); done = save(page, 'uiComplete'); done_task = completed_golden(paid_state, done, tid)
        record(page, 'ui-finite-completed-once'); reload_verified(page, 'uiComplete')
        one_seconds(page, 21); later = save(page, 'uiLater')
        check('completed finite UI task survives extra ticks without any new payment/charge/completion', later['orders']['nextJobId'] == done['orders']['nextJobId'] and later['stats']['researchCompleted'] == done['stats']['researchCompleted'] and not later['research']['queue'] and next(t for t in later['orders']['tasks'] if t['id'] == tid) == done_task)
        record(page, 'ui-finite-no-extra-work'); context.close()

        begin_case('separate unchanged canonical natural 06 ->07 ->08 ->09 ->10 handoff replay')
        context, page = boot(fixtures['naturalMilestones']['unpaid']['save']['savedAt'])
        handoff(page, 'unpaid'); unpaid = save(page, 'unpaid')
        one_seconds(page, fixtures['execution']['canonicalPaymentSeconds']); canonical_paid = save(page, 'paid')
        canonical_job = canonical_paid['research']['queue'][0]
        check('actual canonical scheduler issued exactly the original fixed-mother paid identity', unpaid['activePlanetId'] == canonical_paid['activePlanetId'] == COLONY and canonical_job['jobId'] == unpaid['orders']['nextJobId'] and canonical_job['source'] == 'plan' and canonical_job['paid'] == GOLD_COMPUTER and abs(canonical_job['totalSeconds'] - 6144 / 35) < 1e-10)
        select(page, '#planet-select', HOME); advance(page, 1000); select(page, '#planet-select', COLONY); one_seconds(page, 4)
        canonical_inflight = save(page, 'inflight'); record(page, 'canonical-natural-inflight'); reload_verified(page, 'inflight')
        check('canonical actual job keeps exact identity and frozen saved clock across real planet selection', canonical_inflight['research']['queue'][0]['jobId'] == canonical_job['jobId'] and canonical_inflight['research']['queue'][0]['totalSeconds'] == canonical_job['totalSeconds'] and canonical_inflight['research']['queue'][0]['remainingSeconds'] == fixtures['naturalMilestones']['inflight']['save']['state']['research']['queue'][0]['remainingSeconds'])
        one_seconds(page, fixtures['execution']['canonicalFinishAfterFiveSeconds']); canonical_done = save(page, 'complete')
        canonical_task = completed_golden(canonical_paid, canonical_done, canonical_job['taskId']); reload_verified(page, 'complete')
        one_seconds(page, 21); canonical_later = save(page, 'later')
        check('canonical extra live ticks equal unchanged milestone10 and never pay again', canonical_later['orders']['nextJobId'] == canonical_done['orders']['nextJobId'] and canonical_later['stats']['researchCompleted'] == canonical_done['stats']['researchCompleted'] and next(t for t in canonical_later['orders']['tasks'] if t['id'] == canonical_job['taskId']) == canonical_task)
        record(page, 'canonical-natural-no-extra-work'); context.close()

        begin_case('explicit synthetic saved-duration compatibility and ordinary waiting research controls; not natural evidence')
        context, page = boot(fixtures['syntheticFrozen']['savedAt'])
        import_save(page, fixtures['syntheticFrozen'], 'synthetic-only-saved-total600-remaining123')
        save(page, 'syntheticFrozen')
        check('old paid active queue displays saved total600/remaining123 instead of recalculated network quote', page.locator(QUEUE + ' [data-q="detail"]').inner_text() == '剩余 2 分 3 秒 / 共 10 分 0 秒')
        select(page, '#planet-select', HOME); old = save(page, 'syntheticFrozenHome')
        trusted_click(page, '[data-action="research"][data-id="laser_tech"]'); queued = save(page, 'syntheticWaitingLaser')
        check('ordinary laser button charges literal M200/C100 and issues next manual job without new task authority', queued['research']['queue'][1]['paid'] == {'metal': '200', 'crystal': '100', 'deuterium': '0'} and queued['research']['queue'][1]['jobId'] == old['orders']['nextJobId'] and queued['research']['queue'][1]['source'] == 'manual' and queued['research']['queue'][1]['taskId'] is None and queued['orders']['tasks'] == old['orders']['tasks'])
        details = page.locator(QUEUE + ' [data-q="detail"]').all_text_contents()
        check('waiting paid ETA is explicitly current-condition estimate, while active saved timer stays frozen', details == ['剩余 2 分 3 秒 / 共 10 分 0 秒', '等待中 · 已付款 · 按当前条件预计 1 秒（开工时确定）'], details)
        select(page, '#planet-select', COLONY); save(page, 'syntheticWaitingColony')
        check('actual planet navigation cannot reprice active job or start the waiting job', page.locator(QUEUE + ' [data-q="detail"]').all_text_contents() == details)
        reload_verified(page, 'syntheticWaitingColony')
        native_scroll_to(page, QUEUE); snap(page, 'synthetic-frozen-active-and-current-waiting-eta.png'); record(page, 'synthetic-frozen-waiting-no-reprice'); context.close()
        begin_case('suite integrity')
        check('no uncaught JavaScript errors or failed production requests', not errors and not failed_requests, {'errors': errors, 'failedRequests': failed_requests})
        completed = True; flush(); browser.close()
except BaseException as error:
    failure = {'case': case, 'error': repr(error), 'traceback': traceback.format_exc()}
    if active_page is not None:
        try:
            failure['rawSave'] = raw(active_page)
            failure['card'] = active_page.locator(CARD).all_text_contents()
            failure['queue'] = active_page.locator(QUEUE).all_text_contents()
            failure['status'] = active_page.locator('[data-bind="status"]').all_text_contents()
            snap(active_page, 'failure.png')
        except BaseException as capture_error:
            failure['captureError'] = repr(capture_error)
    flush(); raise
finally:
    signal.alarm(0); flush()
