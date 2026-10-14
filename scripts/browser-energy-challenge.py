#!/usr/bin/env python3
"""Bounded three-lane native acceptance for the energy-tightening candidate.

Real Chromium/HTTP/V8/Storage/File/confirm and trusted normal controls. Only
Date/performance/RAF logical time is compressed; this is not forty minutes of
human play. Explicit DOM/storage attacks are separate labeled scenarios. Every
snapshot is obtained inside its browser document lifecycle. An immutable final
seal includes the worker log, streaming assertions and all original artifacts.
Sources use cold HTTP caching; no cache/performance claim is made. The separate
REALCLOCK migration document keeps actual Date/performance/RAF untouched.
"""
import argparse
from copy import deepcopy
from decimal import Decimal
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import traceback
from urllib.parse import unquote, urljoin, urlparse
import uuid
from dataclasses import replace
import zipfile

from energy_challenge_census import (ACTIONS, BUDGETS, CONTROLS, LANES, LIFECYCLE,
    MIGRATIONS, PLAN_SCHEMA, RETIREMENTS, SCENARIOS, SCHEMA, WIDTHS, canonical,
    original, reference, resolve_reference, sha, state_from, validate_plan, load_boundary_checker,
    derive_realclock_request)

from energy_challenge_trace import (prepare_plan as prepare_trace, NativeFrameTrace, location, source_offset,
    to_replay_epoch, through_manual_save, freeze_manual_boundary)

ROOT = Path(__file__).resolve().parents[1]
KEY = 'infinity.original-p4.save.v1'
CLASSIFICATION = 'compressed-logical-time-native-browser; not-whole-human-play'


def exclusive_json(path, value):
    with Path(path).open('xb') as handle: handle.write(canonical(value) + b'\n')


def http_response_evidence(response):
    request=response.request;chain=[];seen=set()
    while request is not None:
        assert id(request) not in seen and len(chain)<16, 'Nonfinite HTTP redirect chain'
        seen.add(id(request));chain.append({'url':request.url,'resourceType':request.resource_type})
        request=request.redirected_from
    return {'url':response.url,'status':response.status,'requestChainFinalFirst':chain,
            'cacheHeaders':{key:value for key,value in response.headers.items()
                            if key.lower() in ('cache-control','etag','last-modified','age')}}


def process_identity(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(') ', 1)[1].split()
        return {'pid': pid, 'start': fields[19], 'state': fields[0]}
    except (OSError, IndexError): return None


def supervise(args):
    out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()): raise ValueError('Native output must be a fresh empty directory')
    run_id = uuid.uuid4().hex; marker = '--energy-challenge-owner=' + run_id
    owned, signals = {}, []
    def collect(root):
        pending = [root, *owned]
        for entry in Path('/proc').iterdir():
            if entry.name.isdigit():
                try:
                    if marker.encode() in (entry / 'cmdline').read_bytes().split(b'\0'): pending.append(int(entry.name))
                except OSError: pass
        seen = set()
        while pending:
            pid = pending.pop()
            if pid in seen: continue
            seen.add(pid); current = process_identity(pid)
            if not current or (pid in owned and current['start'] != owned[pid]['start']): continue
            owned[pid] = current
            for children in Path(f'/proc/{pid}/task').glob('*/children'):
                try: pending.extend(map(int, children.read_text().split()))
                except OSError: pass
    def terminate(signum):
        for pid, observed in reversed(list(owned.items())):
            current = process_identity(pid)
            if current and current['start'] == observed['start'] and current['state'] != 'Z':
                try:
                    os.kill(pid, signum); signals.append({'pid':pid,'start':current['start'],'signal':signum})
                except ProcessLookupError: pass
    def interrupted(signum, _frame): raise KeyboardInterrupt(f'Signal {signum}')
    signal.signal(signal.SIGTERM, interrupted)
    expired, error, code = False, None, 1
    with (out / 'worker.log').open('x') as log:
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:],
            '--worker', '--run-id='+run_id, '--owner-marker='+marker], stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        deadline=time.monotonic()+BUDGETS[args.lane]+20
        try:
            while child.poll() is None:
                collect(child.pid)
                if time.monotonic() >= deadline: expired=True; break
                time.sleep(.2)
            code=child.poll() if child.poll() is not None else 1
        except BaseException as caught: error=repr(caught)
        finally:
            collect(child.pid); terminate(signal.SIGTERM)
            try: child.wait(timeout=2)
            except subprocess.TimeoutExpired: pass
            collect(child.pid); terminate(signal.SIGKILL); child.wait(timeout=2)
    survivors=[process_identity(pid) for pid,known in owned.items() if process_identity(pid)
               and process_identity(pid)['start']==known['start'] and process_identity(pid)['state']!='Z']
    exclusive_json(out/'supervisor.json',{'runId':run_id,'budgetSeconds':BUDGETS[args.lane]+20,'expired':expired,
        'error':error,'workerExitCode':code,'ownedProcesses':list(owned.values()),'signals':signals,'survivors':survivors})
    files=[]
    for path in sorted(out.rglob('*')):
        if path.is_file(): files.append(reference(path,out))
        assert not path.is_symlink(), path
    exclusive_json(out/'seal.json',{'schema':'infinity-energy-challenge-artifact-seal-v1','runId':run_id,'files':files})
    print(json.dumps({'lane':args.lane,'completed':code==0 and not expired and not error and not survivors,'output':str(out)}))
    return 0 if code==0 and not expired and not error and not survivors else 1


def production_action_handlers(text):
    """Exact four-method retirement and original recovery/state binding only."""
    ident=r'[A-Za-z_$][A-Za-z0-9_$]*'
    pattern=(rf'(?<![\w$])async function (?P<name>{ident})\((?P<action>{ident})\)\{{'
        rf'(?:var {ident}(?:,{ident})*;)?'
        rf'\["import-text","import-file","reset","prestige"\]\.includes\((?P=action)\.type\)&&'
        rf'\((?P<view>{ident})\.retireNpcRehearsal\(\),(?P=view)\.retireManualUnits\(\),'
        rf'(?P=view)\.retireBuildingTemplateBatch\(\),(?P=view)\.retireEnergyChallenge\(\)\),'
        rf'(?P<session>{ident})\.cancelPendingImport\(\);'
        rf'const (?P<recovery>{ident})=\["save","export","export-legacy","import-text","import-file","reset","dismiss-notice","dismiss-offline"\]'
        rf'\.includes\((?P=action)\.type\);if\((?P=session)\.mode!=="ready"&&!(?P=recovery)\)\{{'
        rf'{ident}=(?P=session)\.message,{ident}\(\);return\}}'
        rf'(?=const {ident}=(?P<state>{ident}),{ident}=(?P=state)\.unlocked;)')
    return list(re.finditer(pattern,text))


def production_serializers(text):
    """Complete r16 serializer wrapper, with exact energy validation lineage."""
    ident=r'[A-Za-z_$][A-Za-z0-9_$]*'; state=r'(?P=state)'
    def call(field): return rf'{field}:{ident}\({state}\.{field}\)'
    def copy(field): return rf'{field}:\{{\.\.\.{state}\.{field}\}}'
    def direct(field): return rf'{field}:{state}\.{field}'
    fields=[*(call(field) for field in ('buildingTemplates','formations','researchTemplates','orders')),
        rf'planets:{state}\.planets\.map\({ident}\)',direct('activePlanetId'),rf'deepSpace:structuredClone\({state}\.deepSpace\)',
        copy('universe'),call('fleets'),r'messages:(?P=messages)',direct('nextFleetId'),call('research'),
        rf'darkMatter:(?P<big>{ident})\({state}\.darkMatter\)',copy('items'),
        rf'boosters:{state}\.boosters\.map\((?P<booster>{ident})=>\(\{{\.\.\.(?P=booster)\}}\)\)',
        call('arcade'),call('lifetime'),rf'warpCores:(?P=big)\({state}\.warpCores\)',copy('curvature'),rf'totalTime:(?P=big)\({state}\.totalTime\)',
        *(direct(field) for field in ('manualClicks','seenEnergyShortage','hasPrestiged')),
        rf'unlockedCards:{state}\.unlockedCards\.slice\(\)',call('protocols'),rf'unlocked:{state}\.unlocked\.slice\(\)',copy('stats'),direct('offlineBonusHours')]
    prefix=(rf'(?<![\w$])(?<!async )function (?P<name>{ident})\((?P<state>{ident})\)\{{'
        rf'{ident}\({state},!1\)(?:;|,){ident}\({state},!1\);'
        rf'const (?P<challenge>{ident})={ident}\({state}\.energyChallenge\);'
        rf'{ident}\({state},(?P=challenge)\);'
        rf'const (?P<messages>{ident})={ident}\({state}\.messages\);'
        rf'{ident}\({state},!1\)(?:;|,){ident}\({state}\)(?:;|,){ident}\({state},(?P=messages)\);'
        rf'const (?P<context>{ident})={ident}\({state}\.universe\.seed,(?:512|{ident}),'
        rf'{state}\.planets\.map\((?P<planet>{ident})=>(?P=planet)\.coordinates\)\);'
        rf'return\{{energyChallenge:(?P=challenge),npcEconomy:{ident}\({state}\.npcEconomy,(?P=context)\),'
        rf'npcBattles:{ident}\({state}\.npcBattles,(?P=context)\),'
        rf'terraformerGrantJobFloor:{ident}\({state}\.terraformerGrantJobFloor,{state}\.orders\.nextJobId\),')
    return list(re.finditer(prefix+','.join(fields)+r'\}\}',text))


CLOCK=r'''(()=>{
 if(location.origin!==__ORIGIN__)return;
 const nativeRAF=requestAnimationFrame.bind(window),epoch=__EPOCH__;
 let elapsed=Number(sessionStorage.getItem('ec-elapsed')||0),originElapsed=elapsed;
 Date.now=()=>epoch+elapsed;
 Object.defineProperty(performance,'now',{value:()=>elapsed-originElapsed});
 requestAnimationFrame=fn=>nativeRAF(()=>fn(elapsed-originElapsed));
 window.__ecAdvance=async ms=>{if(ms!==0&&ms!==1000)throw Error('Only one-second live ticks');elapsed+=ms;
  sessionStorage.setItem('ec-elapsed',String(elapsed));await new Promise(nativeRAF);await new Promise(nativeRAF);return elapsed;};
 const navigationSequence=Number(sessionStorage.getItem('ec-navigation')||0)+1;sessionStorage.setItem('ec-navigation',String(navigationSequence));
 window.__ecObserveRequested=false;window.__ecLive=null;
 window.__ecWitness={documentId:crypto.randomUUID(),navigationSequence,events:[],
  nativeStorage:localStorage instanceof Storage&&[Storage.prototype.getItem,Storage.prototype.setItem].every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn))),
  nativeFile:/\[native code\]/.test(Function.prototype.toString.call(File.prototype.text)),nativeConfirm:/\[native code\]/.test(Function.prototype.toString.call(confirm))};
 document.addEventListener('click',event=>{const n=event.target.closest?.('button,summary');if(n)window.__ecWitness.events.push({kind:'click',trusted:event.isTrusted,id:n.id,tab:n.dataset.tab||null,action:n.dataset.action||null});},true);
 document.addEventListener('change',event=>{const n=event.target;window.__ecWitness.events.push({kind:'change',trusted:event.isTrusted,id:n.id,file:n.files?.[0]?{name:n.files[0].name,size:n.files[0].size}:null});},true);
 __STARTUP__
})();'''


REALCLOCK_WITNESS = r"""(()=>{
 if(location.origin!==__ORIGIN__)return;
 window.__ecObserveRequested=false;window.__ecLive=null;
 window.__ecWitness={documentId:crypto.randomUUID(),navigationSequence:1,events:[],
  nativeStorage:localStorage instanceof Storage&&[Storage.prototype.getItem,Storage.prototype.setItem].every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn))),
  nativeFile:/\[native code\]/.test(Function.prototype.toString.call(File.prototype.text)),
  nativeConfirm:/\[native code\]/.test(Function.prototype.toString.call(confirm)),
  nativeClocks:[Date.now,performance.now,requestAnimationFrame].every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn)))};
 document.addEventListener('click',event=>{const n=event.target.closest?.('button,summary');if(n)window.__ecWitness.events.push({kind:'click',trusted:event.isTrusted,id:n.id,tab:n.dataset.tab||null,action:n.dataset.action||null});},true);
})();"""


class Evidence:
    """O(total bytes) immutable files plus one append-only assertion stream."""
    def __init__(self,out,report):
        self.out=out; self.report=report; self.count=0; self.scenario=None
        self.journal=(out/'checks.jsonl').open('x',encoding='utf8')
    def dump(self,label,raw):
        if isinstance(raw,str): raw=raw.encode()
        assert isinstance(raw,bytes)
        label=re.sub(r'[^a-zA-Z0-9._-]','_',label)
        name=f'{self.count:06d}-{label}'; self.count+=1
        with (self.out/name).open('xb') as handle: handle.write(raw)
        return {'file':name,'sha256':sha(raw),'bytes':len(raw)}
    def check(self,name,condition,detail=None):
        row={'sequence':self.report['checkCount'],'scenario':self.scenario or 'binding','name':name,'passed':bool(condition)}
        if detail is not None: row['detail']=detail
        self.journal.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n');self.journal.flush()
        self.report['checkCount']+=1
        assert condition,name
        assert time.monotonic()-self.report['_started']<self.report['budgetSeconds'],'Approved purpose-bound worker budget expired'
    def imported(self,root,ref,label): return self.dump(label,resolve_reference(root,ref,external=True))


def preserve_native_storage_receipt(cap,kind,row,dump):
    """Persist the unfiltered CDP row before any receipt assertion can fail."""
    events=cap['trace'].events
    receipt={'deliverySequence':len(cap['rawStorageReceipts']),'kind':kind,'row':deepcopy(row),
             'traceEventCount':len(events),'traceLastSequence':events[-1]['sequence'] if events else None}
    cap['rawStorageReceipts'].append(receipt)
    cap['rawStorageReceiptRefs'].append(dump('real-clock-raw-storage-receipt.json',canonical(receipt)))


class ManualStorageBoundary:
    """Join independent CDP streams without altering the original save prefix.

    Runtime.bindingCalled and DOMStorage notifications need not arrive in the
    same order. Freeze the trace synchronously at save-result, then collect the
    actual storage receipts through that same exact final write. Nothing is
    synthesized from a successful save; the complete receipt chain must match.
    """
    def __init__(self,application_url,preserve=None):
        self.application_url=application_url;self.events=[];self.frozen=None;self.result=None;self.preserve=preserve
    def record(self,kind,row):
        self.events.append(deepcopy({'kind':kind,**row}));self._finish()
    def capture(self,observer,marker):
        assert self.frozen is None, 'Only one original manual boundary'
        self.frozen=freeze_manual_boundary(observer,self.events,marker);self._finish()
    def _finish(self):
        if self.frozen is None or self.result is not None:return
        final=self.frozen['trace']['events'][-1]['primaryRaw']
        if not any(row.get('key')==KEY and row['kind'] in ('added','updated') and row['newValue']==final for row in self.events):return
        receipts=deepcopy(self.events)
        # Save the exact candidate chain before validation, including rejects.
        if self.preserve is not None:self.preserve(self.frozen,receipts)
        request=derive_realclock_request(self.frozen['trace'],receipts,self.frozen['marker'],self.application_url)
        self.result={**self.frozen,'storageEvents':receipts,'writes':request['nativePrimaryWrites']}


def worker(args):
    from playwright.sync_api import sync_playwright
    out=Path(args.output); plan_path=Path(args.plan).resolve(); plan_raw=original(plan_path); plan=json.loads(plan_raw)
    assert sha(plan_raw)==args.expected_plan_sha256
    cases=validate_plan(plan,plan_path.parent,args.lane)
    common_path=Path(args.common_identity).resolve(); common_raw=original(common_path); common=json.loads(common_raw)
    identity=common['identity']; assert common['identitySha256']==sha(canonical(identity))
    assert plan['sourceSha']==identity['source']['sourceSha']==args.expected_sha
    assert plan['runtimeNode']==identity['runtimeNode']==args.runtime_node
    parsed=urlparse(args.url);assert parsed.scheme in ('http','https') and parsed.path.endswith('/') and not parsed.query and not parsed.fragment
    origin=f'{parsed.scheme}://{parsed.netloc}'
    report={'schema':SCHEMA,'runId':args.run_id,'lane':args.lane,'sourceSha':args.expected_sha,'runtimeNode':args.runtime_node,
        'version':args.expected_version,'applicationUrl':args.url,'classification':CLASSIFICATION,'completed':False,'result':'incomplete',
        'budgetSeconds':BUDGETS[args.lane],'fixedScenarioCensus':list(LANES[args.lane]),'scenarios':[],
        'checkCount':0,'errors':[],'assets':[],'sourceFiles':[],'_started':time.monotonic()}
    evidence=Evidence(out,report);check=evidence.check;dump=evidence.dump
    report['plan']=dump('prepared-plan.json',plan_raw)
    def portable(value):
        if isinstance(value,dict):
            if set(value)>={'file','sha256','bytes'}:
                return {**value,**evidence.imported(plan_path.parent,value,'prepared-input-original.json')}
            return {key:portable(item) for key,item in value.items()}
        if isinstance(value,list):return list(map(portable,value))
        return value
    report['portablePlan']=dump('portable-prepared-plan.json',canonical(portable(plan)))
    report['commonIdentity']=dump('common-identity.json',common_raw)
    current=None;active_page=None;capture=None;release=None;trace_plan=None
    def raw(page): return page.evaluate('(key)=>localStorage.getItem(key)',KEY)
    def advance(page,seconds=0):
        assert type(seconds) is int and 0<=seconds<=1800
        if seconds==0: page.evaluate('window.__ecAdvance(0)')
        else:
            for _ in range(seconds): page.evaluate('window.__ecAdvance(1000)')
        current['logicalSecondsAdvanced']+=seconds
    def tab(page,name):
        if page.locator('[data-bind="offline-modal"]').is_visible(): page.locator('[data-action="dismiss-offline"]').click()
        page.locator(f'[data-tab="{name}"]').click();advance(page)
    def observe(page,label,expected=None,mode=None):
        before=dump(label+'-storage-before.json',raw(page) or 'null')
        page.evaluate('window.__ecLive=null;window.__ecObserveRequested=true');advance(page)
        value=page.evaluate('window.__ecLive')
        check('original-frame one-shot observation resolved',value is not None and not page.evaluate('window.__ecObserveRequested'))
        after=dump(label+'-storage-after.json',raw(page) or 'null')
        actual=dump(label+'-engine.json',value);observed=json.loads(value)
        check('read-only observation preserves complete immediate primary bytes',before['sha256']==after['sha256'])
        check('observation belongs to this live native document',observed['documentId']==page.evaluate('window.__ecWitness.documentId'))
        if mode is not None:check('actual SaveSession mode matches expected',observed['mode']==mode,observed['mode'])
        if expected is not None:
            expected_ref=evidence.imported(plan_path.parent,expected,label+'-expected-original.json')
            expect_state=state_from(original(out/expected_ref['file']))
            check('complete original-frame state equals complete independent expected state: '+label,observed['state']==expect_state,
                {'actual':actual,'expected':expected_ref})
            current['comparisons'].append({'label':label,'actual':actual,'expected':expected_ref,'storageBefore':before,'storageAfter':after})
        return observed,actual
    def compare_prior(page,label,prior_ref,mode=None):
        return observe(page,label,reference(out/prior_ref['file']),mode)
    def noop(page,label,before):
        after=dump(label+'-after-primary.json',raw(page) or 'null')
        check('complete primary raw bytes unchanged: '+label,resolve_reference(out,before)==resolve_reference(out,after))
        current['noops'].append({'label':label,'before':before,'after':after})
    def export_live(page,protected=False):
        tab(page,'save');page.locator('[data-action="export"]').click();advance(page)
        text=page.locator('[data-bind="transfer"]').input_value();ref=dump('native-export.json',text)
        check('native export contains nonempty exact original text',bool(text))
        current.setdefault('exports',[]).append(ref)
        return text,ref
    def import_file(page,ref,accept=True,invalid=False):
        path=Path(ref['file']) if Path(ref['file']).is_absolute() else plan_path.parent/ref['file']
        resolve_reference(plan_path.parent,ref,external=True)
        tab(page,'save');dialogs=[]
        def answer(dialog):
            valid=dialog.type=='confirm' and dialog.message.startswith('已读取存档 v9/r') and '是否替换当前进度' in dialog.message
            row={'type':dialog.type,'message':dialog.message,'accepted':valid and accept};dialogs.append(row)
            dialog.accept() if valid and accept else dialog.dismiss()
        page.on('dialog',answer)
        try:
            page.locator('[data-bind="import-file"]').set_input_files(str(path))
            page.wait_for_function('()=>document.querySelector("[data-bind=status]")?.textContent.includes("'+('导入失败' if invalid else '已导入并存入本地' if accept else '已取消文件导入')+'")')
            advance(page)
        finally:page.remove_listener('dialog',answer)
        check('native import confirmation census is exact',len(dialogs)==(0 if invalid else 1),dialogs)
        check('trusted native file selection uses exact name and byte length',any(e['kind']=='change' and e['trusted'] and e.get('file')=={'name':path.name,'size':path.stat().st_size} for e in page.evaluate('window.__ecWitness.events')))
        current.setdefault('imports',[]).append({'source':evidence.imported(plan_path.parent,ref,'import-source-original.json'),'dialogs':dialogs,'accepted':accept and not invalid})
    def seal_scripts(page,cap):
        rows=[]
        for event in cap['executed']:
            url=event['url'];name=unquote(urlparse(url).path).removeprefix(unquote(parsed.path))
            if not name.endswith('.js'):continue
            responses=[r for r in cap['responses'] if r.url==url]
            receipt=dump('http-response-identity.json',canonical({'executed':event,'file':name,
                'matchingResponseCount':len(responses),'responses':[http_response_evidence(row) for row in cap['responses']],
                'protocolResponses':cap['networkResponses'],'cachePolicy':'Network.setCacheDisabled(true) before navigation; inherited by reload'}))
            current.setdefault('httpIdentityObservations',[]).append(receipt)
            check('one real HTTP200 response for each executed asset',len(responses)==1 and responses[0].status==200 and name in release['files'],receipt)
            code=cap['cdp'].send('Debugger.getScriptSource',{'scriptId':event['scriptId']})['scriptSource']
            http=responses[0].body();check('full V8 equals exact HTTP and release bytes',sha(code)==sha(http)==release['files'][name])
            row={'file':name,'httpOriginal':dump('executed-http.js',http),'v8Original':dump('executed-v8.js',code)};rows.append(row)
            handlers=production_action_handlers(code)
            if handlers:
                serializers=production_serializers(code);frames=list(re.finditer(r'window\.requestAnimationFrame\(([\w$]+)\);window\.setInterval',code))
                check('exact complete production handler serializer frame resolve uniquely',len(handlers)==len(serializers)==len(frames)==1)
                state=handlers[0].group('state');session=handlers[0].group('session');serializer=serializers[0].group('name')
                declaration=re.search(r'function '+re.escape(frames[0].group(1))+r'\([\w$]+\)\{',code)
                check('exact original frame declaration exists',declaration is not None)
                pos=declaration.end();point=location(code,pos);line=point['lineNumber'];column=point['columnNumber']
                expression=(f'(globalThis.__ecObserveRequested&&(globalThis.__ecLive=JSON.stringify({{state:{serializer}({state}),'
                    f'mode:{session}.mode,expectedRaw:{session}.expectedRaw,protectedRaw:{session}.protectedRaw,'
                    f'offline:{{rawSeconds:{session}.loaded.rawSeconds,appliedSeconds:{session}.loaded.appliedSeconds,capped:{session}.loaded.capped,capSeconds:{session}.loaded.capSeconds}},'
                    f'frameAt:performance.now(),wallAt:Date.now(),documentId:globalThis.__ecWitness.documentId,navigationSequence:globalThis.__ecWitness.navigationSequence}}),globalThis.__ecObserveRequested=false),false)')
                binding=cap['cdp'].send('Debugger.setBreakpointByUrl',{'url':url,'lineNumber':line,'columnNumber':column,'condition':expression})
                check('read-only original-frame observer has exactly one bound location',len(binding.get('locations',[]))==1)
                resolved=binding['locations'][0];offset=source_offset(code,resolved['lineNumber'],resolved['columnNumber'])
                check('observer resolves inside exact original first frame statement',pos<=offset<code.index(';',pos))
                cap.setdefault('breakpoints',[]).append(binding['breakpointId'])
                current.setdefault('observerBindings',[]).append({'sourceFile':name,'source':row['v8Original'],'line':line,'column':column,'expression':expression,'binding':binding})
        check('nonempty exact executed source inventory and one state observer',bool(rows) and len(cap.get('breakpoints',[]))==1)
        cap['sources']=rows
        response=next(r for r in cap['responses'] if r.url==trace_plan.url)
        cap['trace'].verify_executed(response.body())
    def seal_scope(page,cap):
        witness=page.evaluate('window.__ecWitness')
        check('event scope retains genuine Storage/File/native confirm',witness['nativeStorage'] and witness['nativeFile'] and witness['nativeConfirm'])
        current['eventScopes'].append({'documentId':witness['documentId'],'navigationSequence':witness['navigationSequence'],
            'original':dump('document-events.json',canonical(witness)),'executedSources':cap['sources'],
            'trace':dump('native-readonly-trace.json',canonical(cap['trace'].snapshot()))})
    def reload(page,cap):
        seal_scope(page,cap)
        for breakpoint in cap.get('breakpoints',[]):cap['cdp'].send('Debugger.removeBreakpoint',{'breakpointId':breakpoint})
        cap['breakpoints']=[];cap['responses'].clear();cap['executed'].clear();cap['networkResponses'].clear()
        page.reload(wait_until='networkidle');seal_scripts(page,cap);advance(page)
    def boot(browser,case):
        nonlocal active_page,capture
        context=browser.new_context(viewport={'width':case.get('width',1440),'height':1000},service_workers='block')
        startup=''
        if case['id'] in MIGRATIONS:
            source=resolve_reference(plan_path.parent,case['input'],external=True).decode()
            startup="if(!sessionStorage.getItem('ec-startup-seeded')){localStorage.setItem("+json.dumps(KEY)+','+json.dumps(source)+");sessionStorage.setItem('ec-startup-seeded','1')}"
        context.add_init_script(CLOCK.replace('__ORIGIN__',json.dumps(origin)).replace('__EPOCH__',str(case['epoch'])).replace('__STARTUP__',startup))
        page=context.new_page();active_page=page;page.set_default_timeout(7000);page.set_default_navigation_timeout(10000)
        capture={'cdp':context.new_cdp_session(page),'executed':[],'responses':[],'networkResponses':[]}
        capture['cdp'].send('Network.enable');capture['cdp'].send('Network.setCacheDisabled',{'cacheDisabled':True})
        capture['cdp'].on('Network.responseReceived',lambda event:capture['networkResponses'].append(event) if event.get('type')=='Script' else None)
        capture['trace']=NativeFrameTrace(capture['cdp'],trace_plan);capture['trace'].install()
        capture['cdp'].send('Debugger.enable')
        capture['cdp'].on('Debugger.scriptParsed',lambda event:capture['executed'].append(event) if event.get('url','').startswith(args.url) else None)
        page.on('response',lambda response:capture['responses'].append(response) if urlparse(response.url).path.endswith('.js') else None)
        page.on('pageerror',lambda error:report['errors'].append(str(error)))
        response=page.goto(args.url,wait_until='networkidle');check('real application HTTP200',response is not None and response.status==200)
        seal_scripts(page,capture)
        if case['id'] not in MIGRATIONS:import_file(page,case['input'])
        expected=case.get('initialExpected',case['input']) if case['id'] not in ('unknown-r15','malformed-r16-completion') else None
        initial,initial_ref=observe(page,'initial',expected,case.get('expectedMode','ready'))
        current['initialEngine']=initial_ref
        if expected is None:
            # Unknown-revision placeholder randomness is not an expected game.
            # Only prove the same frozen actual placeholder in its own document.
            compare_prior(page,'protected-placeholder-stable',initial_ref,case.get('expectedMode','protected'))
        return context,page,capture,initial,initial_ref
    def review(page,action):
        assert action in ACTIONS;tab(page,'curvature')
        button=page.locator('#energy-challenge-'+action)
        check('requested actual challenge review control enabled',button.is_enabled())
        button.click();advance(page)
        check('native review is visible with an enabled confirm',page.locator('#energy-challenge-review').is_visible() and page.locator('#energy-challenge-confirm').is_enabled())
    def challenge(page,step):
        before,before_ref=observe(page,'before-'+step['action'])
        review(page,step['action']);dialogs=[];trace_start=len(capture['trace'].events)
        def answer(dialog):
            valid=dialog.type=='confirm' and '能源紧缩' in dialog.message
            row={'type':dialog.type,'message':dialog.message,'accepted':valid and step.get('accept',True)};dialogs.append(row)
            dialog.accept() if row['accepted'] else dialog.dismiss()
        page.once('dialog',answer);page.locator('#energy-challenge-confirm').click();advance(page)
        check('one exact native challenge confirmation',len(dialogs)==1 and dialogs[0]['type']=='confirm',dialogs)
        current.setdefault('dialogs',[]).extend(dialogs)
        after,after_ref=observe(page,'after-'+step['action'],step.get('expected'),step.get('mode','ready'))
        if dialogs[0]['accepted'] and step.get('mode','ready')=='ready':
            disk_raw=raw(page);disk=json.loads(disk_raw);check('accepted candidate persisted and read back before visible adoption',disk['state']==after['state'] and after['expectedRaw']==disk_raw and after['protectedRaw'] is None)
            transaction=[event for event in capture['trace'].events[trace_start:] if event['kind'] in ('save-input','save-result')]
            check('one original SaveSession input and readback-result precede visible adoption',len(transaction)==2 and [e['kind'] for e in transaction]==['save-input','save-result'] and transaction[0]['state']==after['state'] and transaction[1]['visibleState']==before['state'] and transaction[1]['ok'] is True and transaction[1]['candidateRaw']==transaction[1]['expectedRaw']==transaction[1]['primaryRaw']==disk_raw)
            current['transitions'].append({'transaction':dump('save-before-adopt-events.json',canonical(transaction)),'action':step['action'],'before':before_ref,'after':after_ref,'persisted':dump('adopted-primary-original.json',disk_raw),'savedState':disk['state'],'dialog':dialogs[0]})
        else:
            check('cancelled native confirmation preserves full visible state',after['state']==before['state'])
            check('cancelled confirmation never reaches SaveSession save',not [event for event in capture['trace'].events[trace_start:] if event['kind']=='save-input'])
            before_raw=dump('cancelled-confirm-before-primary.json',before['expectedRaw'] or 'null');noop(page,'cancelled-native-confirm',before_raw)
        return before,after
    def hit(page,control):
        node=page.locator('#energy-challenge-'+control);node.scroll_into_view_if_needed()
        value=node.evaluate('''n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {control:n.id.replace('energy-challenge-',''),width:innerWidth,rect:{x:r.x,y:r.y,width:r.width,height:r.height},visible:r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden',unoccluded:[[.2,.5],[.5,.5],[.8,.5]].every(([x,y])=>{const h=document.elementFromPoint(r.x+r.width*x,r.y+r.height*y);return h===n||n.contains(h)}),text:n.innerText}}''')
        value['screenshot']=dump('responsive-'+control+'.png',page.screenshot(caret='initial'))
        check('actual control visible hit-testable within viewport',value['visible'] and value['unoccluded'] and value['rect']['x']>=-1 and value['rect']['x']+value['rect']['width']<=value['width']+1,value)
        current.setdefault('visibility',[]).append(value)
    def run_step(page,step,cap):
        kind=step['kind'];label=step.get('label',kind)
        if kind=='challenge':challenge(page,step);return
        if kind=='import':import_file(page,step['input'],step.get('accept',True),step.get('invalid',False))
        elif kind=='review':review(page,step['action'])
        elif kind=='cancel-review':page.locator('#energy-challenge-cancel').click();advance(page)
        elif kind=='advance':advance(page,step['seconds'])
        elif kind=='reload':reload(page,cap)
        elif kind in ('build','research'):
            before,before_ref=observe(page,'before-'+label)
            tab(page,'facilities' if kind=='build' else 'research')
            page.locator(f'[data-action="{"enqueue" if kind=="build" else "research"}"][data-id="{step["id"]}"]').click();advance(page)
            after,after_ref=observe(page,'after-'+label,step.get('expected'))
            if step.get('thirdQueue'):
                old=before['state'];new=after['state'];old_home=next(p for p in old['planets'] if p['id']==old['activePlanetId']);home=next(p for p in new['planets'] if p['id']==new['activePlanetId'])
                old_queue=old_home['buildQueue'] if kind=='build' else old['research']['queue'];queue=home['buildQueue'] if kind=='build' else new['research']['queue']
                added=[job for job in queue if job['jobId'] not in {j['jobId'] for j in old_queue}]
                check('third ordinary queue admission creates one actually paid job',len(old_queue)==2 and len(queue)==3 and len(added)==1 and any(Decimal(v)>0 for v in added[0]['paid'].values()))
                current.setdefault('paidThirdQueues',[]).append({'kind':kind,'beforeCount':len(old_queue),'afterCount':len(queue),'job':added[0],'before':before_ref,'after':after_ref})
            return
        elif kind=='cancel-build':
            tab(page,'facilities');page.locator(f'[data-bind="queue-list"] [data-action="cancel-queue"][data-index="{step.get("index",0)}"]').click();advance(page)
        elif kind=='accelerate-build':
            tab(page,'facilities');page.locator('[data-bind="queue-list"] [data-action="dm-speedup"][data-target="build"][data-mode="finish"]').first.click();advance(page)
        elif kind in ('ordinary-prestige','reset'):
            tab(page,'curvature' if kind=='ordinary-prestige' else 'save');dialogs=[]
            def answer(dialog):dialogs.append({'type':dialog.type,'message':dialog.message});dialog.accept()
            page.once('dialog',answer);page.locator('[data-action="'+('prestige' if kind=='ordinary-prestige' else 'reset')+'"]').click();advance(page)
            check('one native explicit reset or ordinary curvature confirmation',len(dialogs)==1 and dialogs[0]['type']=='confirm',dialogs)
            if kind=='reset':
                state,reset_actual=observe(page,'native-pristine-reset')
                oracle=step['resetOracle'];template=state_from(resolve_reference(plan_path.parent,oracle['template'],external=True))
                seed=state['state']['universe']['seed'];expected=load_boundary_checker().pristine_reset_expected(template,seed)
                expected_ref=dump('independent-pristine-reset.json',canonical(expected))
                current['resetExpectation']={'observedSeed':seed,'actual':reset_actual,'template':evidence.imported(plan_path.parent,oracle['template'],'pristine-template.json'),'expected':expected_ref,
                    'persisted':dump('native-reset-primary.json',raw(page))}
                observe(page,'pristine-reset-full-state',reference(out/expected_ref['file']),'ready')
        elif kind in ('auto-toggle','auto-edit'):
            tab(page,'protocol');assert type(step['slot']) is int and 0<=step['slot']<20
            if kind=='auto-toggle':
                selector=f'[data-slot="{step["slot"]}"] [data-field="enabled"]'
                node=page.locator(selector);check('active auto-curvature native toggle is disabled',node.is_disabled())
                node.evaluate('(node)=>{node.disabled=false;node.click()}');advance(page)
            else:
                assert step['path']=='action.kind' and step['value']=='prestige'
                page.locator(f'[data-slot="{step["slot"]}"] [data-path="action.kind"]').select_option('prestige');advance(page)
        if step.get('expected'):observe(page,label,step['expected'],step.get('mode','ready'))
    def lifecycle(page,case,initial,initial_ref,context):
        action=case.get('action','enter');ident=case['id'];reason=ident[len(action)+1:] if ident.startswith(action+'-') else ident
        review(page,action);page.evaluate('window.__ecRetained=document.querySelector("#energy-challenge-confirm")')
        if reason.startswith('storage-'):
            # Labeled delegate-preserving fault, armed only after review. Normal
            # navigation/import ran with untouched native Storage methods.
            page.evaluate('''({key,mode})=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;let armed=false;
              Storage.prototype.setItem=function(k,v){if(this===localStorage&&k===key){if(mode==='storage-write-failure')throw new DOMException('Explicit native acceptance write failure','QuotaExceededError');const result=set.call(this,k,v);armed=true;return result}return set.call(this,k,v)};
              Storage.prototype.getItem=function(k){if(this===localStorage&&k===key&&armed){armed=false;throw new Error('Explicit native acceptance postwrite readback failure')}return get.call(this,k)};
              window.__ecRestoreStorage=()=>{Storage.prototype.getItem=get;Storage.prototype.setItem=set};}''',{'key':KEY,'mode':reason})
            dialogs=[]
            def answer(dialog):dialogs.append({'type':dialog.type,'message':dialog.message,'accepted':True});dialog.accept()
            page.once('dialog',answer);page.locator('#energy-challenge-confirm').click();advance(page);page.evaluate('window.__ecRestoreStorage()')
            check('fault exercised actual native challenge confirmation once',len(dialogs)==1 and dialogs[0]['type']=='confirm')
            after,_=compare_prior(page,'failed-save-visible-not-adopted',initial_ref,'protected')
            exported,ref=export_live(page,True);check('failed save retains complete recoverable source',state_from(exported)==initial['state'])
            disk=dump('uncertain-write-primary.json',raw(page));current['uncertainDisk']=disk
            expected=case.get('faultExpected')
            check('fault expectation supplied for actual uncertain disk outcome',bool(expected))
            check('actual disk matches declared write-failure or postwrite outcome',state_from(resolve_reference(out,disk))==state_from(resolve_reference(plan_path.parent,expected,external=True)))
            return
        if reason in ('external-storage-protection','external-r16-misplaced-authority'):
            foreign=context.new_page();foreign.goto(args.url,wait_until='networkidle')
            external=resolve_reference(plan_path.parent,case['externalInput'],external=True).decode()
            foreign.evaluate('({key,raw})=>localStorage.setItem(key,raw)',{'key':KEY,'raw':external});advance(page)
            current['externalOriginal']=dump('external-primary-original.json',external)
            compare_prior(page,'external-conflict-visible-not-adopted',initial_ref,'conflict')
            check('other tab primary original remains exact',raw(page)==external)
            exported,_=export_live(page,True);check('conflict recovery export preserves exact prior source',exported==initial['expectedRaw']);foreign.close()
        elif reason=='clone':page.evaluate('()=>{const n=window.__ecRetained,c=n.cloneNode(true);c.id="energy-challenge-clone";n.after(c);window.__ecRetained=c}')
        elif reason=='detach':page.evaluate('window.__ecRetained.remove()')
        elif reason=='ancestor-aba':page.evaluate('()=>{const n=document.querySelector("#energy-challenge"),p=n.parentNode,next=n.nextSibling;n.remove();p.insertBefore(n,next)}')
        elif reason=='hide-show':
            page.evaluate('document.querySelector("#energy-challenge").hidden=true');advance(page)
            page.evaluate('document.querySelector("#energy-challenge").hidden=false')
        elif reason=='tab-aba':tab(page,'facilities');tab(page,'curvature')
        elif reason=='active-planet-aba':
            planets=initial['state']['planets'];check('active-planet ABA fixture contains a real alternative identity',len(planets)>=2)
            other=next(p['id'] for p in planets if p['id']!=initial['state']['activePlanetId'])
            page.locator('#planet-select').select_option(other);advance(page)
            observe(page,'active-planet-away',case['planetSelections'][0]['expected'])
            page.locator('#planet-select').select_option(initial['state']['activePlanetId']);advance(page)
            observe(page,'active-planet-restored',case['planetSelections'][1]['expected'])
            tab(page,'curvature')
        elif reason=='world-import-aba':import_file(page,case['input']);tab(page,'curvature')
        elif reason=='cancelled-import':import_file(page,case['input'],accept=False);tab(page,'curvature')
        elif reason=='invalid-import':import_file(page,case['invalidInput'],invalid=True);tab(page,'curvature')
        else:raise AssertionError('Unknown fixed retirement '+reason)
        advance(page);dialogs=[]
        def unexpected(dialog):dialogs.append({'type':dialog.type,'message':dialog.message});dialog.dismiss()
        page.on('dialog',unexpected)
        try:
            current['replayCount']=0
            for number in range(3):
                before=dump('stale-replay-before.json',raw(page) or 'null')
                page.evaluate('window.__ecRetained.disabled=false;window.__ecRetained.click()');advance(page)
                noop(page,f'stale-replay-{number+1}',before);current['replayCount']+=1
                compare_prior(page,f'stale-visible-{number+1}',initial_ref,'conflict' if reason.startswith('external-') else 'ready')
            check('all repeated retired/clone replay attempts show no confirmation',dialogs==[],dialogs)
        finally:page.remove_listener('dialog',unexpected)
    def real_clock_migration(browser,case):
        nonlocal active_page,capture
        source=resolve_reference(plan_path.parent,case.get('realClockInput',case['input']),external=True).decode()
        context=browser.new_context(viewport={'width':1440,'height':1000},service_workers='block',storage_state={
            'cookies':[],'origins':[{'origin':origin,'localStorage':[{'name':KEY,'value':source}]}]})
        context.add_init_script(REALCLOCK_WITNESS.replace('__ORIGIN__',json.dumps(origin)))
        page=context.new_page();active_page=page;page.set_default_timeout(7000)
        cap={'cdp':context.new_cdp_session(page),'executed':[],'responses':[],'networkResponses':[]};capture=cap
        cap['cdp'].send('Network.enable');cap['cdp'].send('Network.setCacheDisabled',{'cacheDisabled':True})
        cap['cdp'].on('Network.responseReceived',lambda event:cap['networkResponses'].append(event) if event.get('type')=='Script' else None)
        cap['trace']=NativeFrameTrace(cap['cdp'],trace_plan);cap['trace'].install()
        cap['cdp'].on('Debugger.scriptParsed',lambda event:cap['executed'].append(event) if event.get('url','').startswith(args.url) else None)
        page.on('response',lambda response:cap['responses'].append(response) if urlparse(response.url).path.endswith('.js') else None)
        page.on('pageerror',lambda error:report['errors'].append(str(error)))
        def preserve_boundary(frozen,receipts):
            current['realClockCapture']={
                'trace':dump('real-clock-boundary-trace.json',canonical(frozen['trace'])),
                'deliveredStorageEvents':dump('real-clock-delivered-storage-events.json',canonical(receipts))}
        storage_boundary=ManualStorageBoundary(args.url,preserve_boundary);cap['storageBoundary']=storage_boundary
        cap['rawStorageReceipts']=[];cap['rawStorageReceiptRefs']=current['realClockRawStorageReceipts']=[]
        def storage_event(kind,row):
            preserve_native_storage_receipt(cap,kind,row,dump)
            if row.get('storageId',{}).get('isLocalStorage') and row['storageId'].get('securityOrigin')==origin:
                storage_boundary.record(kind,row)
                if kind in ('removed','cleared'):check('real-clock trace never deletes native storage',False,row)
        cap['cdp'].send('DOMStorage.enable')
        for method,kind in [('domStorageItemAdded','added'),('domStorageItemUpdated','updated'),('domStorageItemRemoved','removed'),('domStorageItemsCleared','cleared')]:
            cap['cdp'].on('DOMStorage.'+method,lambda row,kind=kind:storage_event(kind,row))
        response=page.goto(args.url,wait_until='networkidle');check('real-clock application HTTP200',response is not None and response.status==200)
        seal_scripts(page,cap)
        witness=page.evaluate('window.__ecWitness');check('real Date performance RAF functions remain native',witness['nativeClocks'])
        events=cap['trace'].events;ready=next(row for row in events if row['kind']=='ready');read=next(row for row in events if row['kind']=='source-read')
        startup={'sourceRaw':read['raw'],'constructorNow':read['constructorNow'],'mode':ready['mode'],'state':ready['state'],
                 'loaded':ready['loaded'],'primaryRaw':ready['primaryRaw'],'backupRaw':ready['backupRaw'],'lastTickAt':ready['lastTickAt']}
        check('real-clock startup source and recoverable backup are byte exact',startup['sourceRaw']==startup['backupRaw']==source)
        if page.locator('[data-bind="offline-modal"]').is_visible():page.locator('[data-action="dismiss-offline"]').click()
        page.locator('[data-tab="save"]').click()
        marker=cap['trace'].events[-1]['sequence']
        def capture_boundary(event):
            if event['sequence']>marker and event['kind']=='save-result' and any(row['sequence']>marker and row['kind']=='action' and row.get('actionType')=='save' for row in cap['trace'].events):
                prefix=through_manual_save(cap['trace'].events,marker)
                storage_boundary.capture(cap['trace'],marker)
                cap['trace'].on_event=None
        cap['trace'].on_event=capture_boundary
        page.locator('[data-action="save"]').click()
        # Original trace prefix ends at this complete real manual-save result.
        # Live frames after it cannot fit, replace, or alter those captured clocks.
        page.evaluate('0')
        check('manual result froze exact original trace prefix',storage_boundary.frozen is not None and not cap['trace'].failures)
        # Pump delivery of the independent CDP storage stream only. This never
        # retries the manual action, replays a frame or substitutes a clock.
        receipt_deadline=min(time.monotonic()+7,report['_started']+BUDGETS[args.lane]-10)
        while storage_boundary.result is None and time.monotonic()<receipt_deadline:
            page.wait_for_timeout(10)
        if 'realClockCapture' not in current:preserve_boundary(storage_boundary.frozen,storage_boundary.events)
        check('manual result has its complete independent native storage receipt chain',storage_boundary.result is not None)
        boundary=storage_boundary.result
        prefix=boundary['trace']['events'];epoch=to_replay_epoch(prefix)
        final=prefix[-1]['primaryRaw'];backup=prefix[-1]['backupRaw']
        check('independent native primary and backup readback matches manual boundary',
              raw(page)==final and page.evaluate('(key)=>localStorage.getItem(key)',KEY+'.backup')==backup)
        writes=boundary['writes']
        check('final native readback equals actual captured manual save',final==next(row['candidateRaw'] for row in reversed(prefix) if row['kind']=='save-result'))
        request={'epoch':epoch,'startup':startup,'nativePrimaryWrites':writes,'finalPrimaryRaw':final,'finalBackupRaw':backup}
        request_ref=dump('real-clock-replay-request.json',canonical(request))
        remaining=max(1,int(BUDGETS[args.lane]-(time.monotonic()-report['_started'])-10))
        result=subprocess.run([args.node,'--import','tsx',str(ROOT/'scripts/energy-challenge-migration-fixtures.mjs'),'replay',args.public_r14_source],
                              input=json.dumps(request),text=True,capture_output=True,cwd=ROOT,timeout=remaining,check=False)
        stdout=dump('real-clock-replay-stdout.json',result.stdout);stderr=dump('real-clock-replay-stderr.log',result.stderr)
        check('independent public-r14 real startup/live-clock replay passes',result.returncode==0,{'stdout':stdout,'stderr':stderr})
        replay=json.loads(result.stdout);check('public replay reports strict full-state success',replay['status']=='passed')
        current['realClock']={'classification':'unmodified-native-Date-performance-RAF; exact-observed-event-replay',
            'request':request_ref,'result':stdout,'stderr':stderr,'nativeStorageEvents':dump('real-clock-native-storage-events.json',canonical(boundary['storageEvents'])),
            'trace':dump('real-clock-original-trace.json',canonical(boundary['trace'])),'nativeClockFunctions':witness['nativeClocks'],
            'manualMarker':marker,'manualEndSequence':boundary['endSequence'],'documentId':witness['documentId']}
        page.locator('[data-action="export"]').click();check('real-clock export uses trusted native control',bool(page.locator('[data-bind="transfer"]').input_value()))
        seal_scope(page,cap);context.close();active_page=None
    def capture_failure(error):
        if 'failure' in report:return
        failure={'error':repr(error),'traceback':traceback.format_exc(),'scenario':current['id'] if current else 'binding','captureStatus':'inside-live-playwright'}
        report['failure']=failure
        if active_page is None:return
        # These host copies do not pump CDP callbacks. Preserve them first while
        # Playwright is still live, before any fallible browser-side reads.
        tasks={}
        if capture is not None and 'storageBoundary' in capture:
            tasks.update({'raw-storage-receipts':lambda:canonical(capture['rawStorageReceipts']),
                          'storage-events':lambda:canonical(capture['storageBoundary'].events),
                          'manual-boundary':lambda:canonical(capture['storageBoundary'].frozen)})
        tasks.update({'dom':lambda:active_page.content(),'primary':lambda:raw(active_page) or 'null',
               'events':lambda:canonical(active_page.evaluate('window.__ecWitness')),
               'trace':lambda:canonical(capture['trace'].snapshot()),
               'screenshot':lambda:active_page.screenshot(full_page=True,caret='initial')})
        for name,operation in tasks.items():
            try:failure[name]=dump('failure-'+name+('.png' if name=='screenshot' else '.html' if name=='dom' else '.json'),operation())
            except BaseException as error:failure.setdefault('captureErrors',{})[name]=repr(error)
    try:
        # Hash every declared original source byte and preserve a complete ZIP.
        inventory=identity['source']['sourceCode'];archive=io.BytesIO()
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as zipper:
            for name,digest in sorted(inventory.items()):
                assert not Path(name).is_absolute() and '..' not in Path(name).parts
                value=original(ROOT/name);check('exact source original: '+name,sha(value)==digest)
                info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.external_attr=int(identity['source']['sourceModes'][name],8)<<16
                zipper.writestr(info,value,compress_type=zipfile.ZIP_DEFLATED);report['sourceFiles'].append({'path':name,'sha256':digest})
        report['sourceArchive']=dump('full-source-manifest.json',canonical(inventory));report['fullSourceZip']=dump('full-source-originals.zip',archive.getvalue())
        with sync_playwright() as playwright:
            try:
                browser=playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox',args.owner_marker])
                report['browserVersion']=browser.version;request=playwright.request.new_context()
                response=request.get(urljoin(args.url,'release.json'),timeout=10000);release_raw=response.body();release=json.loads(release_raw)
                report['release']=dump('http-release-original.json',release_raw)
                check('exact r16 release SHA version and 62 asset census',response.status==200 and release['sourceSha']==args.expected_sha and release['version']==args.expected_version and release['saveVersion']==9 and release['saveRevision']==16 and len(release['files'])==62)
                check('release is exact common-identity bytes',sha(release_raw)==identity['releaseSha256'])
                for name,digest in sorted(release['files'].items()):
                    assert not Path(name).is_absolute() and '..' not in Path(name).parts
                    response=request.get(urljoin(args.url,name),timeout=10000);body=response.body()
                    check('actual HTTP asset equals release and common identity',response.status==200 and response.url==urljoin(args.url,name) and sha(body)==digest==identity['assets'][name])
                    report['assets'].append({'file':name,'sha256':sha(body),'httpOriginal':dump('http-'+name.replace('/','_'),body)})
                request.dispose()
                trace_candidates=[]
                for asset in report['assets']:
                    if asset['file'].endswith('.js'):
                        body=resolve_reference(out,asset['httpOriginal'])
                        if production_action_handlers(body.decode()):
                            trace_candidates.append(prepare_trace(urljoin(args.url,asset['file']),body,asset['sha256'],production_action_handlers,production_serializers))
                check('exactly one fully verified native trace production source',len(trace_candidates)==1)
                trace_plan=trace_candidates[0]
                for case in cases:
                    current={'id':case['id'],'completed':False,'classification':case['classification'],'comparisons':[],
                        'eventScopes':[],'transitions':[],'noops':[],'logicalSecondsAdvanced':0}
                    report['scenarios'].append(current);evidence.scenario=case['id']
                    context,page,cap,initial,initial_ref=boot(browser,case)
                    ident=case['id']
                    if ident in LIFECYCLE:lifecycle(page,case,initial,initial_ref,context)
                    elif ident in MIGRATIONS:
                        source=evidence.imported(plan_path.parent,case['input'],'startup-source-original.json');current['startupOriginal']=source
                        if ident.startswith('migrate-r'):
                            current['revision']=case['revision'];expected=state_from(resolve_reference(plan_path.parent,case['initialExpected'],external=True))
                            before=state_from(resolve_reference(plan_path.parent,case['input'],external=True))
                            keys=page.evaluate('()=>Object.keys(localStorage)');backups=[]
                            for key in keys:
                                if key!=KEY:
                                    value=page.evaluate('key=>localStorage.getItem(key)',key)
                                    if value and sha(value)==source['sha256']:backups.append(dump('migration-backup-original.json',value))
                            check('migration keeps exact recoverable old original in native storage',len(backups)>=1)
                            current['backupOriginal']=backups[0]
                            check('migration primary durably contains exact expected state',json.loads(raw(page))['state']==expected)
                            oracle=json.loads(resolve_reference(plan_path.parent,case['historicalOracle'],external=True))
                            current['historicalOracle']=evidence.imported(plan_path.parent,case['historicalOracle'],'historical-oracle-original.json')
                            current['offline']={'requestedSeconds':case['offlineSeconds'],'oracleRequestedSeconds':oracle['gapMilliseconds']/1000,
                                'actualTotalTimeDelta':str(Decimal(initial['state']['totalTime'])-Decimal(before['totalTime'])),
                                'expectedTotalTimeDelta':str(Decimal(expected['totalTime'])-Decimal(before['totalTime'])),**initial['offline']}
                            check('actual startup charged exactly the independently expected offline duration',initial['offline']['rawSeconds']==case['offlineSeconds'] and initial['offline']['appliedSeconds']==oracle['loaded']['appliedSeconds'])
                            reload(page,cap);observe(page,'migration-reload-no-double-time',case['initialExpected'],'ready')
                        else:
                            exported,protected_ref=export_live(page,True);current['protectedOriginal']=protected_ref
                            current['primaryUnchanged']=sha(raw(page))==source['sha256']
                            check('protected unknown/malformed source remains byte-for-byte in primary',current['primaryUnchanged'])
                            check('native protected export is byte-for-byte original',sha(exported)==source['sha256'])
                    elif ident.startswith('responsive-'):
                        current['width']=case['width']
                        for phase in case['phases']:
                            if phase.get('input'):import_file(page,phase['input'])
                            review(page,phase['action']);hit(page,phase['action']);hit(page,'confirm');hit(page,'cancel')
                            before=dump('responsive-cancel-before.json',raw(page));page.locator('#energy-challenge-cancel').click();advance(page)
                            noop(page,'responsive-cancel-'+phase['action'],before)
                            observe(page,'responsive-'+phase['action'],phase.get('expected',phase.get('input',case['input'])))
                    else:
                        for step in case.get('steps',[]):run_step(page,step,cap)
                        final,final_ref=observe(page,'case-final',case.get('finalExpected'))
                        if ident=='paid-proof-score':
                            attempt=final['state']['energyChallenge']['active'];check('all four actual postentry paid completion proofs and production score observed',len(attempt['proofs'])==4 and all(attempt['proofs'].values()) and int(attempt['scoreUnits'])>0)
                        elif ident=='auto-card-disable-config':
                            before_cards=initial['state']['protocols']['slots'];after_cards=final['state']['protocols']['slots'];targets=0
                            for old,new in zip(before_cards,after_cards):
                                card=old.get('card')
                                if card and card['action']['kind']=='prestige' and card['enabled']:
                                    targets+=1;expected=dict(card,enabled=False);check('enabled auto-curvature including locked slot retains exact configuration',new['card']==expected)
                            check('auto-disable fixture actually covers multiple enabled cards including locked',targets>=2 and case['lockedAutoSlot']>=case['unlockedSlotCount'])
                        elif ident=='new-game-clear':
                            challenge_state=final['state']['energyChallenge'];check('new game clears active attempt completion and score authority',challenge_state['active'] is None and challenge_state['completion'] is None and challenge_state['nextAttemptId']==1)
                    export_live(page);check('no application exception in native case',not report['errors'],report['errors'])
                    seal_scope(page,cap);current['completed']=True
                    context.close();active_page=None
                    if case.get('realClockTrace'):real_clock_migration(browser,case)
                check('all fixed lane scenarios completed in exact order',[r['id'] for r in report['scenarios']]==list(LANES[args.lane]) and all(r['completed'] for r in report['scenarios']))
                report['completed']=True;report['result']='passed';browser.close()
            except BaseException as error:
                capture_failure(error)
                raise
    except BaseException as error:
        if 'failure' not in report:
            report['failure']={'error':repr(error),'traceback':traceback.format_exc(),'scenario':current['id'] if current else 'binding','captureStatus':'outside-browser-or-startup'}
    finally:
        report['hostElapsedSeconds']=time.monotonic()-report.pop('_started');evidence.journal.close()
        exclusive_json(out/'report.json',report)
    return 0 if report['completed'] else 1


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lane',required=True,choices=LANES)
    parser.add_argument('--url',required=True);parser.add_argument('--plan',required=True)
    parser.add_argument('--expected-plan-sha256',required=True);parser.add_argument('--expected-sha',required=True)
    parser.add_argument('--expected-version',required=True);parser.add_argument('--runtime-node',required=True)
    parser.add_argument('--node',default='node');parser.add_argument('--public-r14-source',required=True)
    parser.add_argument('--common-identity',required=True);parser.add_argument('--output',required=True);parser.add_argument('--chromium')
    parser.add_argument('--worker',action='store_true',help=argparse.SUPPRESS);parser.add_argument('--owner-marker',default='',help=argparse.SUPPRESS)
    parser.add_argument('--run-id',default='',help=argparse.SUPPRESS)
    args=parser.parse_args()
    return worker(args) if args.worker else supervise(args)


if __name__=='__main__':sys.exit(main())
