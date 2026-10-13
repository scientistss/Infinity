"""Bounded real-HTTP old493/candidate first-lab research copy acceptance.

The independently generated accelerated live-engine journey earns lab1 from an
initial world. This browser resumes its immutable file through native import;
it does not claim to replay that journey in real time. Date/performance values
are frozen at the source epoch solely for exact cross-build DOM/state comparison.
Native RAF dispatch, Storage, File.text, timers, confirm, clicks and scrolling
remain untouched. No game-state/resource/RNG injection or UI restyling is used.
"""
import argparse
import ast
import copy
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

REPORT_NAME = 'report.json'
WORK_SECONDS, SUPERVISOR_SECONDS = 180, 195
WIDTHS = (320, 390, 768, 1440)
OLD_SHA = '49303d3740cf223955386ff984b335ca9b110087'
KEY = 'infinity.original-p4.save.v1'
OLD_EFFECT = '1 级解锁深空星环机（信标版）（第 2 阶段后续版本开放）'
NEW_EFFECT = '1 级解锁深空星环机（信标版）'
IDS = ('energy_tech', 'laser_tech', 'ion_tech', 'hyperspace_tech', 'plasma_tech',
       'combustion_drive', 'impulse_drive', 'hyperspace_drive', 'espionage_tech',
       'computer_tech', 'astrophysics', 'intergalactic_research_network',
       'graviton_tech', 'weapons_tech', 'shielding_tech', 'armour_tech')


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
    marker = '--research-unlock-copy-owner=' + uuid.uuid4().hex
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


def strict_json(value):
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                raise ValueError('Duplicate JSON field: ' + key)
            result[key] = item
        return result
    return json.loads(value, object_pairs_hook=pairs)


def exact(actual, expected):
    return json.dumps(actual, sort_keys=True, separators=(',', ':')) == json.dumps(expected, sort_keys=True, separators=(',', ':'))


def source_binding(root, expected):
    root = Path(root).resolve()
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.PIPE, timeout=10)
    assert re.fullmatch(r'[0-9a-f]{40}', expected)
    assert git('rev-parse', 'HEAD').decode().strip() == expected
    assert git('diff', '--name-only', expected, '--', 'src', 'public', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json') == b''
    paths = git('ls-tree', '-rz', '--name-only', expected, '--', 'src', 'public', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json').decode().split('\0')
    hashes = {}
    for path in filter(None, paths):
        committed = git('show', expected + ':' + path)
        assert (root / path).read_bytes() == committed, 'Source differs from exact Git commit: ' + path
        hashes[path] = sha(committed)
    assert {'src/ui/present.ts', 'src/data/research.ts', 'package.json'} <= set(hashes)
    return {'sourceSha': expected, 'files': hashes, 'root': str(root)}


def validate_pair(before, after):
    """Only the complete one-row literal may change; every other field stays exact."""
    assert set(before) == set(after) == {'panelHTML', 'panelText', 'panelNodes', 'cards', 'controls'}
    for side, value in (('before', before), ('after', after)):
        assert [card['id'] for card in value['cards']] == list(IDS)
        assert len(value['controls']) == len(IDS)
        assert [control['id'] for control in value['controls']] == list(IDS)
        assert type(value['panelNodes']) is int and value['panelNodes'] > 0
        expected = OLD_EFFECT if side == 'before' else NEW_EFFECT
        card = value['cards'][10]
        assert set(card) == {'id', 'html', 'text', 'nodeCount', 'level', 'effect', 'effectHTML', 'effectCount', 'effectChildren', 'placement'}
        assert card['id'] == 'astrophysics' and card['level'] == '0'
        assert card['effect'] == expected and card['effectCount'] == 1 and card['effectChildren'] == 0 and card['placement'] is True
        node = '<p class="bld-effect" data-bind="reffect-astrophysics">' + expected + '</p>'
        assert card['effectHTML'] == node and card['html'].count(node) == 1 and value['panelHTML'].count(node) == 1
        assert value['panelHTML'].count('data-bind="reffect-astrophysics"') == 1
        assert card['text'].count(expected) == value['panelText'].count(expected) == 1
        assert value['panelText'].count(OLD_EFFECT) == int(side == 'before')
    projected = copy.deepcopy(before)
    old_node = '<p class="bld-effect" data-bind="reffect-astrophysics">' + OLD_EFFECT + '</p>'
    new_node = '<p class="bld-effect" data-bind="reffect-astrophysics">' + NEW_EFFECT + '</p>'
    projected['panelHTML'] = projected['panelHTML'].replace(old_node, new_node, 1)
    projected['panelText'] = projected['panelText'].replace(OLD_EFFECT, NEW_EFFECT, 1)
    card = projected['cards'][10]
    card['html'] = card['html'].replace(old_node, new_node, 1)
    card['text'] = card['text'].replace(OLD_EFFECT, NEW_EFFECT, 1)
    card['effect'], card['effectHTML'] = NEW_EFFECT, new_node
    assert exact(projected, after), 'Whole research panel differs beyond the single approved effect literal'
    return {'oldEffect': OLD_EFFECT, 'newEffect': NEW_EFFECT, 'cards': len(IDS),
            'panelNodes': after['panelNodes'], 'astrophysicsNodes': after['cards'][10]['nodeCount'],
            'completeRemainingDOMTextControlsEqual': True}


CLOCK = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const raf=window.requestAnimationFrame.bind(window),nativeNow=performance.now.bind(performance);
 Date.now=()=>__EPOCH__;Object.defineProperty(performance,'now',{value:()=>0});
 window.requestAnimationFrame=callback=>raf(()=>callback(0));
 const native=fn=>/\[native code\]/.test(Function.prototype.toString.call(fn));
 window.__researchCopy={events:[],files:[],imports:[],nativeNow,
  integrity:()=>({storage:localStorage instanceof Storage,get:native(Storage.prototype.getItem),set:native(Storage.prototype.setItem),
   remove:native(Storage.prototype.removeItem),clear:native(Storage.prototype.clear),file:native(File.prototype.text),
   confirm:native(window.confirm),timeout:native(setTimeout),interval:native(setInterval),scroll:native(window.scrollBy)})};
 for(const type of ['click','change','scroll'])document.addEventListener(type,event=>{
  const e=event.target, row={type,trusted:event.isTrusted,tab:e.closest?.('[data-tab]')?.dataset.tab??null,action:e.closest?.('[data-action]')?.dataset.action??null};
  window.__researchCopy.events.push(row);
  if(type==='change'&&e.matches?.('[data-bind="import-file"]')){
   const f=e.files[0],file={name:f?.name,size:f?.size,trusted:event.isTrusted,text:null,error:null};
   window.__researchCopy.files.push(file);
   if(f)f.text().then(text=>file.text=text,error=>file.error=String(error));
  }
 },true);
 new MutationObserver(()=>{
  const status=document.querySelector('[data-bind="status"]');
  if(status?.textContent.includes('已导入并存入本地')){
   const raw=localStorage.getItem(__KEY__);
   if(!window.__researchCopy.imports.some(row=>row.raw===raw))window.__researchCopy.imports.push({raw,status:status.textContent});
  }
 }).observe(document,{subtree:true,childList:true,characterData:true});
})();'''

SAMPLE = r'''() => {
 const panels=document.querySelectorAll('[data-tab-panel="research"]');
 if(panels.length!==1)throw Error('Research panel must be unique');
 const panel=panels[0],cards=[...panel.querySelectorAll('article.rcard')];
 return {panelHTML:panel.outerHTML,panelText:panel.innerText,panelNodes:panel.querySelectorAll('*').length,
  cards:cards.map(card=>{
   const id=card.dataset.bind.replace('rcard-',''),effects=card.querySelectorAll(`[data-bind="reffect-${id}"]`),effect=effects[0];
   return {id,html:card.outerHTML,text:card.innerText,nodeCount:card.querySelectorAll('*').length,
    level:card.querySelector(`[data-bind="rlevel-${id}"]`)?.textContent,effect:effect?.textContent,effectHTML:effect?.outerHTML,
    effectCount:document.querySelectorAll(`[data-bind="reffect-${id}"]`).length,effectChildren:effect?.children.length,
    placement:effect?.parentElement===card&&[...card.children].indexOf(effect)===1&&card.children.length===6&&
      effect.previousElementSibling?.matches('.bld-head')&&effect.nextElementSibling?.dataset.bind===`rlater-${id}`};}),
  controls:[...panel.querySelectorAll('button,input,select,textarea')].map(e=>({id:e.dataset.id??e.id,
   tag:e.tagName,html:e.outerHTML,type:e.type,value:e.value,disabled:e.disabled,text:e.textContent}))};
}'''

VISIBLE = r'''({selectors,position}) => {
 const header=()=>{const e=document.querySelector('.topbar'),r=e?.getBoundingClientRect(),p=e?getComputedStyle(e).position:null;
  return {position:p,top:r?.top??0,bottom:r?.bottom??0,obstruction:r&&['sticky','fixed'].includes(p)&&r.top<innerHeight&&r.bottom>0?Math.min(innerHeight,r.bottom):0};};
 const elements=selectors.map(selector=>({selector,e:document.querySelector(selector)}));
 if(elements.some(({e})=>!e))throw Error('Missing visible witness');
 const before=header(),rects=elements.map(({e})=>e.getBoundingClientRect());
 const top=Math.min(...rects.map(r=>r.top)),bottom=Math.max(...rects.map(r=>r.bottom));
 if(position){const desired=before.obstruction+8+Math.max(0,(innerHeight-before.obstruction-16-(bottom-top))/2);window.scrollBy({top:top-desired,left:0,behavior:'instant'});}
 const bar=header();
 return {scrollX,scrollY,viewport:{width:innerWidth,height:innerHeight},header:bar,nodes:elements.map(({selector,e})=>{
  const r=e.getBoundingClientRect(),points=[[.1,.1],[.9,.1],[.5,.5],[.1,.9],[.9,.9]].map(([u,v])=>{
   const x=r.left+r.width*u,y=r.top+r.height*v,hit=document.elementFromPoint(x,y);
   return {x,y,unoccluded:hit!==null&&(hit===e||e.contains(hit)),hit:hit?{tag:hit.tagName,id:hit.id,bind:hit.dataset.bind??null}:null};});
  return {selector,bounds:{x:r.x,y:r.y,width:r.width,height:r.height},points,
   unoccluded:r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=bar.obstruction&&r.bottom<=innerHeight&&points.every(p=>p.unoccluded)};
 })};
}'''


def worker(args):
    from playwright.sync_api import expect, sync_playwright
    out = Path(args.output).resolve()
    started = time.monotonic()
    report = {'schema': 'infinity-research-unlock-copy-browser-v1', 'completed': False, 'result': 'running',
              'checks': [], 'sources': {}, 'releases': {}, 'assets': [], 'stages': [], 'errors': [], 'failedRequests': [],
              'boundsSeconds': {'work': WORK_SECONDS, 'supervisor': SUPERVISOR_SECONDS},
              'runtime': {'python': platform.python_version(), 'platform': platform.platform()},
              'limitations': ['Accelerated natural domain route is independently generated; this browser resumes only its first-lab checkpoint.',
                             'Date/performance values are frozen at the source epoch; native RAF dispatch/timers and all economic state are untouched.',
                             'Widths 320/390/768/1440 are desktop Chromium CSS viewports, not physical mobile devices.']}
    active, browser, case = None, None, 'source validation'

    def flush():
        report.update(activeCase=case, elapsedHostSeconds=round(time.monotonic()-started, 3))
        atomic_json(out / REPORT_NAME, report)

    def check(name, condition, detail=None):
        report['checks'].append({'case': case, 'name': name, 'passed': bool(condition), 'detail': detail})
        flush()
        if not condition:
            raise AssertionError(case + ': ' + name)

    def dump(name, value):
        data = value if isinstance(value, bytes) else value.encode()
        (out / name).write_bytes(data)
        return {'file': name, 'sha256': sha(data), 'bytes': len(data)}

    def process_evidence():
        cdp = browser.new_browser_cdp_session()
        try:
            identities = [process_identity(int(row['id'])) for row in cdp.send('SystemInfo.getProcessInfo')['processInfo']]
            path = out / 'chromium-processes.json'
            previous = strict_json(path.read_bytes()) if path.exists() else []
            unique = {(row['pid'], row['startTimeTicks']): row for row in previous + [row for row in identities if row]}
            atomic_json(path, list(unique.values()))
        finally:
            cdp.detach()

    def failure_capture(error):
        report.update(completed=False, result='failed', failure={'case': case, 'error': repr(error), 'traceback': traceback.format_exc()})
        flush()
        if active and not active['page'].is_closed():
            page = active['page']
            for name, capture in (
                ('storage', lambda: dump('failure-storage.json', json.dumps(page.evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))'), ensure_ascii=False))),
                ('DOM', lambda: dump('failure-document.html', page.content())),
                ('audit', lambda: dump('failure-audit.json', json.dumps(page.evaluate('window.__researchCopy'), ensure_ascii=False))),
                ('screenshot', lambda: page.screenshot(path=str(out / 'failure-viewport.png'), full_page=False, caret='initial', timeout=3000))):
                try:
                    capture()
                except BaseException as diagnostic:
                    report['failure'].setdefault('diagnosticErrors', []).append({'name': name, 'error': repr(diagnostic)})
        flush()

    @contextmanager
    def retain_before_teardown():
        try:
            yield
        except BaseException as error:
            failure_capture(error)
            raise

    def timeout(_signum, _frame):
        raise TimeoutError('Bounded research copy browser work exceeded deadline')

    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(WORK_SECONDS)
    flush()
    try:
        check('historical source is exactly released493', args.before_sha == OLD_SHA)
        for side, root, expected in [('before', args.before_root, args.before_sha), ('after', args.source_root, args.expected_sha)]:
            binding = source_binding(root, expected)
            report['sources'][side] = binding
            check(side + ': actual clean production source matches every tracked Git byte', True, binding)
        before_present = (Path(args.before_root) / 'src/ui/present.ts').read_text()
        after_present = (Path(args.source_root) / 'src/ui/present.ts').read_text()
        removed = '  if (def.id === "astrophysics" && levels.astrophysics < 1) return `${def.effect}（第 2 阶段后续版本开放）`;\n'
        header = 'function researchEffect(state: GameState, def: ResearchDef, target: number): string {\n'
        unused = header + '  const levels = state.research.levels;\n'
        check('production presentation changes only obsolete branch and its unused local', before_present.count(removed) == 1 and before_present.count(unused) == 1 and before_present.replace(removed, '', 1).replace(unused, header, 1) == after_present)
        check('research definitions stay byte-identical', (Path(args.before_root) / 'src/data/research.ts').read_bytes() == (Path(args.source_root) / 'src/data/research.ts').read_bytes())
        fixture = Path(args.fixture_dir)
        receipt_bytes = (fixture / 'receipt.json').read_bytes()
        report['fixtureReceipt'] = dump('source-receipt.json', receipt_bytes)
        check('independently pinned complete receipt hash', re.fullmatch(r'[0-9a-f]{64}', args.expected_receipt_sha256) is not None and sha(receipt_bytes) == args.expected_receipt_sha256)
        receipt = strict_json(receipt_bytes)
        # The concrete independently generated source schema is validated below.
        initial_bytes = (fixture / 'raw-initial.json').read_bytes()
        incoming_bytes = (fixture / 'raw-first-lab.json').read_bytes()
        initial, incoming = strict_json(initial_bytes), strict_json(incoming_bytes)
        report['initial'] = dump('source-raw-initial.json', initial_bytes)
        report['firstLab'] = dump('source-raw-first-lab.json', incoming_bytes)
        validate_fixture(receipt, initial_bytes, incoming_bytes, args.expected_sha)
        declared_files = {row['path']: row['sha256'] for row in receipt['source']['files']}
        actual_files = {path: digest for path, digest in report['sources']['after']['files'].items() if path.startswith('src/') or path in ('package.json', 'package-lock.json')}
        check('all generator source inputs exactly match actual candidate source binding', declared_files == actual_files)
        generator_bytes = (Path(args.source_root) / 'scripts/research-unlock-copy-fixture.mjs').read_bytes()
        committed_generator = subprocess.check_output(['git', 'show', args.expected_sha + ':scripts/research-unlock-copy-fixture.mjs'], cwd=args.source_root, timeout=10)
        check('independent generator itself is clean and Git-bound', generator_bytes == committed_generator and sha(generator_bytes) == receipt['source']['generator']['sha256'])
        check('independent receipt is a passed uninjected natural first-lab journey bound to source and exact raw files', True)
        for side, raw in [('initial', initial), ('firstLab', incoming)]:
            state = raw['state']
            check(side + ': exactly one homeworld with zero research and unchanged lock', len(state['planets']) == 1 and state['activePlanetId'] == state['planets'][0]['id'] and all(type(level) is int and level == 0 for level in state['research']['levels'].values()) and not state['research']['queue'])
        buildings = incoming['state']['planets'][0]['buildings']
        check('checkpoint has earned solar1/deuterium1/lab1 only', buildings['solar_plant'] == buildings['deuterium_synth'] == buildings['research_lab'] == 1 and all(level == 0 for name, level in buildings.items() if name not in ('solar_plant', 'deuterium_synth', 'research_lab')))
        check('first lab checkpoint is coherent and current revision', incoming['savedAt'] == incoming['lastTickAt'] and incoming['revision'] == initial['revision'] and incoming['version'] == initial['version'])
        observations = {}
        with sync_playwright() as playwright, retain_before_teardown():
            browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox', args.owner_marker])
            report['browserVersion'] = browser.version
            process_evidence()
            request = playwright.request.new_context()
            releases = {}
            for side, url, expected, root in [('before', args.before_url, args.before_sha, args.before_root), ('after', args.url, args.expected_sha, args.source_root)]:
                parsed = urlparse(url)
                check(side + ': actual HTTP directory URL', parsed.scheme in ('http', 'https') and bool(parsed.netloc) and parsed.path.endswith('/') and not parsed.query and not parsed.fragment)
                response = request.get(urljoin(url, 'release.json'), timeout=10000)
                body = response.body()
                row = {'url': response.url, 'status': response.status, **dump(side + '-release.json', body)}
                report['releases'][side] = row
                check(side + ': release actual HTTP200 at expected URL', response.status == 200 and response.url == urljoin(url, 'release.json'))
                release = strict_json(body)
                check(side + ': release closed schema has no unknown fields', set(release) == {'version', 'sourceSha', 'lineage', 'saveVersion', 'saveRevision', 'ringVisualVersion', 'ringIconCount', 'deepUiVersion', 'features', 'files'})
                check(side + ': release bound to exact source/revision', release['sourceSha'] == expected and release['saveRevision'] == incoming['revision'] and release['saveVersion'] == incoming['version'])
                check(side + ': HTTP release equals locally built release', body == (Path(root) / 'dist/release.json').read_bytes())
                check(side + ': asset manifest has files and index', isinstance(release['files'], dict) and bool(release['files']) and 'index.html' in release['files'])
                for name, digest in release['files'].items():
                    check(side + ': safe exact release file identity', not name.startswith('/') and '..' not in Path(name).parts and re.fullmatch(r'[0-9a-f]{64}', digest) is not None)
                    asset = request.get(urljoin(url, name), timeout=10000)
                    data = asset.body()
                    record = {'side': side, 'file': name, 'url': asset.url, 'status': asset.status, 'bytes': len(data), 'httpSha256': sha(data), 'releaseSha256': digest}
                    report['assets'].append(record)
                    check(side + ': complete actual HTTP asset equals release and local build', asset.status == 200 and asset.url == urljoin(url, name) and sha(data) == digest and data == (Path(root) / 'dist' / name).read_bytes(), record)
                releases[side] = release
            request.dispose()
            for width in WIDTHS:
                for side, url in [('before', args.before_url), ('after', args.url)]:
                    case = side + '-' + str(width)
                    parsed = urlparse(url)
                    origin = parsed.scheme + '://' + parsed.netloc
                    context = browser.new_context(viewport={'width': width, 'height': 1000}, device_scale_factor=1, reduced_motion='no-preference', service_workers='block')
                    context.add_init_script(CLOCK.replace('__ORIGIN__', json.dumps(origin)).replace('__EPOCH__', str(incoming['savedAt'])).replace('__KEY__', json.dumps(KEY)))
                    page = context.new_page()
                    page.set_default_timeout(8000)
                    page.set_default_navigation_timeout(12000)
                    stage = {'side': side, 'width': width, 'completed': False, 'executedAssets': [], 'screenshots': [], 'dialogs': []}
                    report['stages'].append(stage)
                    active = {'page': page, 'stage': stage}
                    responses, executed = [], []
                    page.on('pageerror', lambda error: report['errors'].append({'case': case, 'error': str(error)}))
                    page.on('requestfailed', lambda request: report['failedRequests'].append({'case': case, 'url': request.url, 'failure': request.failure}))
                    page.on('response', lambda response: responses.append(response) if response.request.resource_type == 'script' else None)
                    cdp = context.new_cdp_session(page)
                    cdp.send('Network.enable')
                    cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
                    cdp.on('Debugger.scriptParsed', lambda event: executed.append(event) if event.get('url', '').startswith(('http://', 'https://')) else None)
                    cdp.send('Debugger.enable')
                    response = page.goto(url, wait_until='networkidle')
                    check('actual real HTTP200 page loaded at pinned URL', response is not None and response.status == 200 and response.url == url)
                    expect(page.locator('[data-bind="energy-chip"]')).to_be_visible()
                    check('native Storage/File/confirm/timers/scroll are intact', all(page.evaluate('window.__researchCopy.integrity()').values()))
                    page.locator('[data-tab="save"]').click()
                    page.locator('[data-action="save"]').click()
                    previous = page.evaluate('(key)=>localStorage.getItem(key)', KEY)
                    current = strict_json(previous)['state']
                    current_planet = next(p for p in current['planets'] if p['id'] == current['activePlanetId'])
                    wanted = [f'已读取存档 v{incoming["version"]}/r{incoming["revision"]}。', f'第 {current["stats"]["launches"] + 1} 轮', f'{len(current["planets"])} 颗星球', f'当前“{current_planet["name"]}”', '读取期间产生的变化也会被替换', '保留当前已保存原件', '写入校验成功后才采用']
                    def answer(dialog):
                        accepted = dialog.type == 'confirm' and all(part in dialog.message for part in wanted)
                        stage['dialogs'].append({'type': dialog.type, 'message': dialog.message, 'accepted': accepted})
                        dialog.accept() if accepted else dialog.dismiss()
                    page.once('dialog', answer)
                    page.locator('[data-bind="import-file"]').set_input_files(str(fixture / 'raw-first-lab.json'))
                    expect(page.locator('[data-bind="status"]')).to_contain_text('已导入并存入本地')
                    page.wait_for_function('window.__researchCopy.files.length===1&&window.__researchCopy.files[0].text!==null')
                    adopted = page.evaluate('(key)=>localStorage.getItem(key)', KEY)
                    file = page.evaluate('window.__researchCopy.files[0]')
                    stage['adopted'] = dump(case + '-adopted.json', adopted)
                    stage['selectedFile'] = file
                    flush()
                    check('single native file import confirmation explicitly identifies replacement', len(stage['dialogs']) == 1 and stage['dialogs'][0]['accepted'])
                    check('unwrapped native File.text saw exact independent source', file['trusted'] is True and file['name'] == 'raw-first-lab.json' and file['size'] == len(incoming_bytes) and file['text'].encode() == incoming_bytes and file['error'] is None)
                    check('complete natural checkpoint state adopted without modification', exact(strict_json(adopted)['state'], incoming['state']))
                    backups = page.evaluate('(key)=>Object.keys(localStorage).filter(k=>k.startsWith(key+".backup")).map(k=>({key:k,raw:localStorage.getItem(k)}))', KEY)
                    stage['backupHashes'] = [{'key': item['key'], 'sha256': sha(item['raw'])} for item in backups]
                    check('actual initial saved bytes remain in native backup', any(row['raw'] == previous for row in backups))
                    check('research is revealed and arcade remains locked at genuine lab1', page.locator('[data-tab="research"]').is_visible() and page.locator('[data-tab="arcade"]').is_hidden())
                    page.locator('[data-tab="research"]').click()
                    expect(page.locator('[data-tab-panel="research"]')).to_be_visible()
                    # Native scroll only; never insert CSS, hide a header or enlarge the viewport.
                    card_selector = '[data-bind="rcard-astrophysics"]'
                    page.locator(card_selector).scroll_into_view_if_needed()
                    page.locator(card_selector + ' img').evaluate_all('(images)=>Promise.all(images.map(image=>image.decode()))')
                    targets = [card_selector, '[data-bind="reffect-astrophysics"]', '[data-bind="rchain-astrophysics"]', '[data-bind="research-astrophysics"]']
                    visible_before = page.evaluate(VISIBLE, {'selectors': targets, 'position': True})
                    # Wait for two real native frames and identical observed geometry;
                    # no sleeps, viewport changes, forced clicks or CSS mutations.
                    page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                    stable_geometry = page.evaluate(VISIBLE, {'selectors': targets, 'position': False})
                    stage['initialGeometry'] = visible_before
                    stage['stableGeometry'] = stable_geometry
                    check('native scroll geometry settled across two real RAF dispatches', exact(visible_before, stable_geometry))
                    visible_before = stable_geometry
                    image_witness = page.locator(card_selector + ' img').evaluate_all('(images)=>images.map(image=>({src:image.currentSrc,complete:image.complete,width:image.naturalWidth,height:image.naturalHeight}))')
                    stage['images'] = image_witness
                    check('actual card image decoded without broken assets', bool(image_witness) and all(row['complete'] and row['width'] > 0 and row['height'] > 0 for row in image_witness))
                    capture = page.evaluate(SAMPLE)
                    stage['rawCapture'] = dump(case + '-research-raw.json', json.dumps(capture, ensure_ascii=False, indent=2))
                    stage['visibleBefore'] = visible_before
                    # Preserve all raw DOM and screenshot bytes before any visibility/parity assertion.
                    png = out / (case + '-astrophysics.png')
                    page.screenshot(path=str(png), full_page=False, animations='allow', caret='initial', timeout=5000)
                    visible_after = page.evaluate(VISIBLE, {'selectors': targets, 'position': False})
                    stage['visibleAfter'] = visible_after
                    stage['screenshots'].append({'file': png.name, 'sha256': sha(png.read_bytes()), 'bytes': png.stat().st_size, 'fullPage': False})
                    flush()
                    check('real screenshot shows card/effect/requirements/control at five unobscured points each', all(node['unoccluded'] for witness in [visible_before, visible_after] for node in witness['nodes']), {'before': visible_before, 'after': visible_after})
                    check('screenshot keeps same native viewport and scroll before/after', visible_before['viewport'] == visible_after['viewport'] == {'width': width, 'height': 1000} and (visible_before['scrollX'], visible_before['scrollY']) == (visible_after['scrollX'], visible_after['scrollY']))
                    check('all sixteen card/action identities remain unique and ordered', [card['id'] for card in capture['cards']] == list(IDS) and [row['id'] for row in capture['controls']] == list(IDS))
                    check('exact visible old or new Astrophysics copy', capture['cards'][10]['effect'] == (OLD_EFFECT if side == 'before' else NEW_EFFECT))
                    # Persist the live in-memory engine through the actual native Save
                    # action after viewing. Reading the prior import alone is insufficient.
                    page.locator('[data-tab="save"]').click()
                    page.locator('[data-action="save"]').click()
                    saved_after_display = page.evaluate('(key)=>localStorage.getItem(key)', KEY)
                    stage['savedAfterDisplay'] = dump(case + '-saved-after-display.json', saved_after_display)
                    stage['nativeTabPreferenceAfterSave'] = page.evaluate('localStorage.getItem("infinity.ui.tab")')
                    flush()
                    check('actual Save proves complete live engine state unchanged by display', exact(strict_json(saved_after_display)['state'], incoming['state']))
                    script_urls = [event['url'] for event in executed]
                    check('executed scripts are nonempty and unique', bool(script_urls) and len(set(script_urls)) == len(script_urls))
                    for event in executed:
                        asset_url = event['url']
                        relative = unquote(urlparse(asset_url).path).removeprefix(unquote(parsed.path))
                        matches = [item for item in responses if item.url == asset_url]
                        check('V8 script has one actual HTTP200 response and one known manifest identity', len(matches) == 1 and matches[0].status == 200 and asset_url == urljoin(url, relative) and relative in releases[side]['files'] and relative.endswith('.js'))
                        http_bytes = matches[0].body()
                        source = cdp.send('Debugger.getScriptSource', {'scriptId': event['scriptId']})['scriptSource']
                        row = {'url': asset_url, 'scriptId': event['scriptId'], 'file': relative, 'httpSha256': sha(http_bytes), 'v8Sha256': sha(source), 'releaseSha256': releases[side]['files'][relative]}
                        stage['executedAssets'].append(row)
                        flush()
                        check('entire HTTP JS/V8-executed source equals release hash', row['httpSha256'] == row['v8Sha256'] == row['releaseSha256'], row)
                    events = page.evaluate('window.__researchCopy.events')
                    stage['events'] = events
                    check('research navigation and native scroll actually occurred with trusted input', any(row['type'] == 'click' and row['tab'] == 'research' and row['trusted'] for row in events) and any(row['type'] == 'scroll' and row['trusted'] for row in events) and all(row['trusted'] for row in events))
                    check('both real native Save actions fired exactly once in their phases', len([row for row in events if row['type'] == 'click' and row['action'] == 'save' and row['trusted']]) == 2)
                    check('no new paid research action was dispatched', not any(row['type'] == 'click' and row['action'] == 'research' for row in events))
                    observations[(side, width)] = capture
                    if side == 'after':
                        stage['parity'] = validate_pair(observations[('before', width)], capture)
                        check('complete research DOM/text/controls equal except the exact approved effect', True, stage['parity'])
                    stage['completed'] = True
                    flush()
                    context.close()
                    active = None
                    process_evidence()
            check('all required width/old/new stages completed exactly once', [(row['side'], row['width']) for row in report['stages']] == [(side, width) for width in WIDTHS for side in ('before', 'after')] and all(row['completed'] for row in report['stages']))
            check('no uncaught application JS errors or failed network requests', not report['errors'] and not report['failedRequests'])
            report.update(completed=True, result='passed')
            flush()
            browser.close()
            browser = None
    except BaseException as error:
        if 'failure' not in report:
            failure_capture(error)
    finally:
        signal.alarm(0)
        if browser:
            try:
                process_evidence()
                browser.close()
            except BaseException as error:
                report.setdefault('cleanupErrors', []).append(repr(error))
                report.update(completed=False, result='failed')
        flush()
    return 0 if report['completed'] and report['result'] == 'passed' else 1


def validate_fixture(receipt, initial_bytes, incoming_bytes, expected_sha):
    from decimal import Decimal
    assert set(receipt) == {'schema', 'status', 'passed', 'completed', 'sourceSha', 'source', 'method', 'initialFactory', 'bounds',
                           'savedAt', 'lastTickAt', 'initial', 'actions', 'rawInitial', 'exclusions', 'final', 'totalEngineSeconds',
                           'actionCount', 'rawFirstLab', 'expectedView', 'researchVisible', 'arcadeUnlocked', 'earnedAchievements', 'earnedDarkMatter'}
    assert receipt['schema'] == 'infinity-research-unlock-natural-v1' and receipt['status'] == 'passed'
    assert receipt['passed'] is True and receipt['completed'] is True
    assert receipt['sourceSha'] == expected_sha
    source = receipt['source']
    assert set(source) == {'sourceRoot', 'head', 'changedSourceFiles', 'files', 'sourceManifestSha256', 'generator'}
    assert source['head'] == expected_sha and source['changedSourceFiles'] == []
    files = source['files']
    assert isinstance(files, list) and files
    assert all(set(row) == {'path', 'sha256'} and re.fullmatch(r'[0-9a-f]{64}', row['sha256']) for row in files)
    paths = [row['path'] for row in files]
    assert paths == sorted(set(paths)) and {'src/ui/present.ts', 'src/data/research.ts', 'package.json', 'package-lock.json'} <= set(paths)
    assert all(path.startswith('src/') or path in ('package.json', 'package-lock.json') for path in paths)
    assert source['sourceManifestSha256'] == sha(json.dumps(files, ensure_ascii=False, separators=(',', ':')))
    assert set(source['generator']) == {'path', 'sha256'} and Path(source['generator']['path']).name == 'research-unlock-copy-fixture.mjs'
    assert re.fullmatch(r'[0-9a-f]{64}', source['generator']['sha256'])
    assert receipt['method'] == 'Accelerated natural-domain engine progression; not elapsed browser/wall-clock play.'
    assert receipt['initialFactory'] == {'api': 'createInitialState(seed, arcadeSeed)', 'worldSeed': 20261013, 'arcadeSeed': 49303029, 'stateEdits': []}
    assert receipt['bounds'] == {'maxEngineSeconds': 300, 'maxActions': 320, 'maxTickSeconds': 1, 'mode': 'live'}
    assert receipt['researchVisible'] is True and receipt['arcadeUnlocked'] is False
    assert receipt['earnedAchievements'] == ['first_deuterium', 'first_lab'] and receipt['earnedDarkMatter'] == '1000'
    assert receipt['initial']['resources'] == {'metal': '500', 'crystal': '500', 'deuterium': '0'}
    assert receipt['initial']['totalTime'] == '0' and receipt['initial']['darkMatter'] == '0' and receipt['initial']['unlocked'] == []
    assert all(type(level) is int and level == 0 for level in receipt['initial']['buildings'].values())
    for name, data, expected_file in [('rawInitial', initial_bytes, 'raw-initial.json'), ('rawFirstLab', incoming_bytes, 'raw-first-lab.json')]:
        row = receipt[name]
        assert set(row) == {'path', 'sha256'} and Path(row['path']).name == expected_file and row['sha256'] == sha(data)
        raw = strict_json(data)
        assert raw['savedAt'] == raw['lastTickAt'] == receipt['savedAt'] == receipt['lastTickAt']
        snapshot = receipt['initial' if name == 'rawInitial' else 'final']
        state = raw['state']
        assert len(state['planets']) == 1
        home = state['planets'][0]
        for field, expected in [('totalTime', state['totalTime']), ('resources', home['resources']), ('buildings', home['buildings']),
                                ('research', state['research']), ('buildQueue', home['buildQueue']), ('darkMatter', state['darkMatter']),
                                ('unlocked', state['unlocked']), ('stats', state['stats'])]:
            assert exact(snapshot[field], expected), 'Receipt differs from immutable source: ' + field
    actions = receipt['actions']
    assert type(receipt['actionCount']) is int and receipt['actionCount'] == len(actions) == 91
    assert type(receipt['totalEngineSeconds']) is int and receipt['totalEngineSeconds'] == 88
    assert [row['index'] for row in actions] == list(range(1, len(actions) + 1))
    paid, elapsed, prior = [], Decimal(0), receipt['initial']
    for row in actions:
        assert exact(row['before'], prior), 'Discontinuous natural action trace'
        assert row['before']['seeds'] == row['after']['seeds'] == receipt['initial']['seeds']
        assert all(level == 0 for level in row['after']['research']['levels'].values()) and row['after']['research']['queue'] == []
        if row['kind'] == 'enqueue':
            assert set(row) == {'index', 'kind', 'building', 'targetLevel', 'source', 'jobId', 'cost', 'paidJob', 'before', 'after'}
            assert row['source'] == 'manual' and row['targetLevel'] == 1 and type(row['jobId']) is int
            assert row['paidJob']['jobId'] == row['jobId'] and row['paidJob']['building'] == row['building']
            assert row['paidJob']['paid'] == row['cost'] and row['paidJob']['source'] == 'manual' and row['paidJob']['taskId'] is None
            assert row['after']['buildQueue'] == row['before']['buildQueue'] + [row['paidJob']]
            assert row['before']['totalTime'] == row['after']['totalTime']
            for resource in ('metal', 'crystal', 'deuterium'):
                difference = Decimal(row['before']['resources'][resource]) - Decimal(row['cost'][resource]) - Decimal(row['after']['resources'][resource])
                assert abs(difference) < Decimal('0.000000001')
            paid.append((row['building'], row['cost']))
        else:
            assert row['kind'] == 'tick'
            assert set(row) == {'index', 'kind', 'reason', 'seconds', 'mode', 'completed', 'before', 'after'}
            assert type(row['seconds']) in (int, float) and 0 < row['seconds'] <= 1 and row['mode'] == 'live'
            assert abs(Decimal(row['after']['totalTime']) - Decimal(row['before']['totalTime']) - Decimal(str(row['seconds']))) < Decimal('0.0000001')
            assert row['completed']['completedResearch'] == row['completed']['completedUnits'] == []
            elapsed += Decimal(str(row['seconds']))
        prior = row['after']
    assert paid == [('solar_plant', {'metal': '75', 'crystal': '30', 'deuterium': '0'}),
                    ('deuterium_synth', {'metal': '225', 'crystal': '75', 'deuterium': '0'}),
                    ('research_lab', {'metal': '200', 'crystal': '400', 'deuterium': '200'})]
    assert elapsed == 88 and exact(prior, receipt['final'])
    assert receipt['final']['totalTime'] == '88' and receipt['final']['buildQueue'] == []
    assert receipt['final']['darkMatter'] == '1000' and receipt['final']['unlocked'] == ['first_deuterium', 'first_lab']
    assert set(receipt['expectedView']) == {'path', 'effect'} and Path(receipt['expectedView']['path']).name == 'expected-view.json'
    assert receipt['expectedView']['effect'] == NEW_EFFECT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
    parser.add_argument('--before-url', default='http://127.0.0.1:4178/Infinity/')
    parser.add_argument('--source-root', default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument('--before-root', required=True)
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--before-sha', required=True)
    parser.add_argument('--fixture-dir', required=True)
    parser.add_argument('--expected-receipt-sha256', required=True)
    parser.add_argument('--output', default='research-unlock-copy-browser-evidence')
    parser.add_argument('--chromium')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--owner-marker', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker and not args.owner_marker:
        parser.error('Use the independent bounded supervisor')
    return worker(args) if args.worker else supervise(args)


if __name__ == '__main__':
    raise SystemExit(main())
