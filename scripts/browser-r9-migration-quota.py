"""Separate native r8 migration and three-copy preservation-capacity acceptance.

Real HTTP, clocks, Storage, File.text and confirm. Only anonymous fixture seeding
and future envelope timestamps are controlled, to isolate migration from offline
catch-up. No quota injection, backup deletion, timer shim or CPU measurement.
A genuine quota refusal is acceptable only with exact original/current retention,
no partial adoption, and protected frozen UI. A successful replacement must retain
both originals. The parent process bounds the complete worker and its browser.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import traceback
from urllib.parse import urljoin, urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--expected-sha', required=True)
parser.add_argument('--fixture', required=True)
parser.add_argument('--session-fixture', required=True)
parser.add_argument('--output', default='migration-quota-evidence')
parser.add_argument('--chromium')
parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
report_path = out / 'report.json'
report = {'completed': False, 'result': 'running', 'checks': [], 'storageEvents': [], 'errors': [],
          'scope': 'Separate actual-r8 upgrade and real three-large-copy preservation peak. A small real-r8 replacement has a distinct world, proving adoption or non-adoption. Does not measure CPU or alter paired clean-current-version two-copy capacity.',
          'clockControl': 'Native clocks; only seeded savedAt/lastTickAt are put 60 seconds in the future to exclude offline catch-up.',
          'sourceSha': args.expected_sha, 'url': args.url}

def sha(raw):
    return hashlib.sha256(raw.encode('utf-8') if isinstance(raw, str) else raw).hexdigest()

def persist():
    temp = report_path.with_suffix('.tmp')
    temp.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    temp.replace(report_path)

def check(name, condition, detail=None):
    report['checks'].append({'name': name, 'passed': bool(condition), 'detail': detail})
    persist()
    if not condition:
        raise AssertionError(name)

def exact(a, b):
    return json.dumps(a, sort_keys=True, separators=(',', ':')) == json.dumps(b, sort_keys=True, separators=(',', ':'))

def save_raw(name, raw):
    (out / name).write_text(raw, encoding='utf-8')
    return {'file': name, 'sha256': sha(raw), 'utf8Bytes': len(raw.encode('utf-8'))}

PROBE = r'''({key,raw,origin}) => {
 if(location.origin!==origin)return;
 const native=f=>/\[native code\]/.test(Function.prototype.toString.call(f));
 const source=JSON.parse(raw);source.savedAt=source.lastTickAt=Date.now()+60000;
 const seeded=JSON.stringify(source,null,2);
 localStorage.setItem(key,seeded);localStorage.setItem('infinity.ui.tab','save');
 const snapshot=()=>({current:localStorage.getItem(key),backups:Object.fromEntries(Object.keys(localStorage)
   .filter(k=>k.startsWith(key+'.backup')).map(k=>[k,localStorage.getItem(k)])),
   status:document.querySelector('[data-bind="status"]')?.textContent??'',
   notice:document.querySelector('[data-bind="notice-text"]')?.textContent??'',
   planet:document.querySelector('[data-bind="ov-planet"]')?.textContent??'',
   played:document.querySelector('[data-bind="played"]')?.textContent??'',
   metal:document.querySelector('[data-bind="amount-metal"]')?.textContent??'',at:performance.now()});
 const p={seeded,migration:null,snapshot,native:{date:native(Date.now),performance:native(performance.now),
   get:native(Storage.prototype.getItem),set:native(Storage.prototype.setItem),file:native(File.prototype.text),confirm:native(confirm),
   raf:native(requestAnimationFrame),timeout:native(setTimeout),interval:native(setInterval)}};
 new MutationObserver(()=>{if(!p.migration&&snapshot().status==='已升级并保存本地存档')p.migration=snapshot();})
   .observe(document,{subtree:true,childList:true,characterData:true});
 window.__r9MigrationQuota=p;
}'''

def worker():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = context = page = None
        try:
            source = json.loads(Path(args.fixture).read_text())
            pair = source['pairedNative']; old_raw = pair['beforeSave']; old_file = json.loads(old_raw)
            check('pressure bytes are the verified actual fixed-source r8 native export',
                  pair['sourceSha'] == '4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b'
                  and sha(old_raw) == pair['beforeSha256'] and old_file['revision'] == 8
                  and 'buildingTemplates' not in old_file['state'])
            sessions = json.loads(Path(args.session_fixture).read_text())
            incoming = sessions['historicalR8']['imported']; key = sessions['key']
            check('replacement is an actual r8 source fixture with a distinguishable world',
                  incoming['revision'] == 8 and 'buildingTemplates' not in incoming['state']
                  and incoming['state']['planets'][0]['name'] != old_file['state']['planets'][0]['name'])
            check('full expected release SHA supplied',len(args.expected_sha)==40 and all(c in '0123456789abcdef' for c in args.expected_sha))
            browser = playwright.chromium.launch(headless=True,executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'),args=['--no-sandbox'])
            context = browser.new_context(viewport={'width':1440,'height':1100}, accept_downloads=True)
            release_response = context.request.get(urljoin(args.url,'release.json'))
            check('actual HTTP release is available',release_response.status==200)
            release = release_response.json(); report['release'] = release
            check('served source and r9 reader are the exact expected release',release['sourceSha']==args.expected_sha and release['saveRevision']==9 and release['saveVersion']==9)
            report['assets'] = []
            for path, digest in release['files'].items():
                if not path.endswith('.js'): continue
                response = context.request.get(urljoin(args.url,path))
                actual = sha(response.body())
                check('full served JavaScript bytes match the release manifest',response.status==200 and actual==digest,{'path':path,'sha256':actual})
                report['assets'].append({'path':path,'sha256':actual})
            check('at least one production script was verified',bool(report['assets']))
            context.add_init_script('('+PROBE+')('+json.dumps({'key':key,'raw':old_raw,'origin':urlparse(args.url).scheme+'://'+urlparse(args.url).netloc},ensure_ascii=False)+')')
            page = context.new_page();page.set_default_timeout(15000)
            page.on('pageerror',lambda error:report['errors'].append(str(error)))
            page.on('requestfailed',lambda request:report['errors'].append('Request failed: '+request.url))
            report['executedScripts']=[];script_responses=[]
            def script_response(response):
                if response.request.resource_type!='script': return
                row={'url':response.url,'status':response.status,'verified':False}
                script_responses.append((response.request,row));report['executedScripts'].append(row)
                if 300<=response.status<400 and response.status!=304:
                    row['classification']='intermediate redirect; final complete HTTP body required';return
                path=urlparse(response.url).path.removeprefix(urlparse(args.url).path)
                check('actual final page script response is HTTP 200',response.status==200,{'url':response.url,'status':response.status})
                digest=sha(response.body())
                check('actual page script response has complete pinned HTTP bytes',release['files'].get(path)==digest,{'url':response.url,'sha256':digest})
                row.update(sha256=digest,verified=True)
            page.on('response',script_response)
            cdp = context.new_cdp_session(page);cdp.send('DOMStorage.enable')
            current_events = []
            def record(event):
                if not event.get('storageId',{}).get('isLocalStorage'): return
                if not event.get('key','').startswith(key): return
                row={'key':event['key'],'oldSha256':sha(event.get('oldValue','')),'newSha256':sha(event.get('newValue','')),'hostWall':time.time()}
                report['storageEvents'].append(row)
                if event['key']==key: current_events.append(dict(event))
            cdp.on('DOMStorage.domStorageItemAdded',record);cdp.on('DOMStorage.domStorageItemUpdated',record)
            response = page.goto(args.url,wait_until='domcontentloaded')
            check('production app is served over real HTTP',response is not None and response.status==200 and urlparse(args.url).scheme in ('http','https'))
            page.wait_for_function('window.__r9MigrationQuota?.migration')
            initial=page.evaluate('() => ({...window.__r9MigrationQuota,migration:window.__r9MigrationQuota.migration,snapshot:null})')
            check('Storage, File.text, confirm, clocks, RAF and timers remain native',all(initial['native'].values()))
            migrated=initial['migration'];seeded=json.loads(initial['seeded']);current=json.loads(migrated['current'])
            report['originalR8']=save_raw('original-r8.json',initial['seeded'])
            report['initialR9']=save_raw('initial-r9.json',migrated['current'])
            check('real r8 startup migration adds only the empty r9 library',current['revision']==9 and exact(current['state'],{'buildingTemplates':{'nextTemplateId':1,'templates':[]},**seeded['state']}))
            check('real migration preserves exactly the original native r8 bytes',migrated['backups']=={key+'.backup':initial['seeded']})
            page.wait_for_timeout(500)
            page.locator('[data-tab="overview"]').click()
            page.evaluate('() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
            queue_probe = """() => Object.fromEntries(['queue','rqueue','squeue'].map(kind=>[kind,
              [...document.querySelectorAll(`[data-bind="${kind}-list-ov"] .queue-item`)].map(row=>({
                key:row.dataset.paidKey,label:row.querySelector('[data-q="label"]')?.textContent,
                detail:row.querySelector('[data-q="detail"]')?.textContent,
                progress:row.querySelector('[data-q="fill"]')?.style.width,
                cancelDisabled:row.querySelector('.queue-cancel')?.disabled}))]))"""
            ready_queue=page.evaluate(queue_probe)
            check('existing real paid building and research provide fine-grained canaries',bool(ready_queue['queue']) and bool(ready_queue['rqueue']))
            page.wait_for_function('({probe,before})=>JSON.stringify(eval("("+probe+")")())!==JSON.stringify(before)',
                                   arg={'probe':queue_probe,'before':ready_queue},timeout=6000)
            advanced_queue=page.evaluate(queue_probe)
            check('healthy real paid countdown or progress visibly advances on native time',
                  any(a['detail']!=b['detail'] or a['progress']!=b['progress'] for kind in ('queue','rqueue')
                      for a,b in zip(ready_queue[kind],advanced_queue[kind])))
            report['healthyPaidQueueCanary']={'before':ready_queue,'after':advanced_queue}
            page.evaluate("window.__quotaStaleCancel=document.querySelector('[data-bind=\"queue-list-ov\"] .queue-cancel')")
            page.locator('[data-tab="save"]').click()
            page.locator('[data-action="save"]').click()
            before=page.evaluate('window.__r9MigrationQuota.snapshot()')
            check('real manual save establishes current r9 progress without replacing the old backup',before['status']=='已保存到本地' and before['backups']==migrated['backups'] and before['current']!=migrated['current'])
            report['preImportR9']=save_raw('pre-import-r9.json',before['current'])
            incoming_raw=page.evaluate('source=>JSON.stringify(source,null,2)',incoming)
            file_path=out/'actual-r8-replacement.json';file_path.write_text(incoming_raw,encoding='utf-8')
            report['incomingR8']=save_raw(file_path.name,incoming_raw)
            page.evaluate(r'''({key,name,size})=>{
              const p=window.__r9MigrationQuota;p.terminal=null;p.selected=null;
              document.addEventListener('change',event=>{
                if(event.target!==document.querySelector('[data-bind="import-file"]'))return;
                const files=event.target.files;
                if(!event.isTrusted||files.length!==1||files[0].name!==name||files[0].size!==size)throw Error('Unexpected native file selection');
                p.selected={trusted:event.isTrusted,name,size,priorRaw:localStorage.getItem(key)};
              },true);
              const observer=new MutationObserver(()=>{
                const observed=p.snapshot();
                if(!p.terminal&&p.selected&&(observed.status==='已导入并存入本地'||observed.status.startsWith('导入失败'))){
                  p.terminal={...observed,selected:p.selected};observer.disconnect();
                }
              });observer.observe(document.querySelector('[data-bind="status"]'),{subtree:true,childList:true,characterData:true});
            }''',{'key':key,'name':file_path.name,'size':len(incoming_raw.encode('utf-8'))})
            confirmations=[]
            def confirm(dialog):
                valid=dialog.type=='confirm' and dialog.message.startswith('已读取存档 v9/r8。') and all(part in dialog.message for part in ('读取期间产生的变化也会被替换','保留当前已保存原件','写入校验成功后才采用'))
                confirmations.append({'message':dialog.message,'valid':valid})
                if valid and len(confirmations)==1:dialog.accept()
                else:dialog.dismiss()
            page.on('dialog',confirm)
            current_start=len(current_events)
            page.locator('[data-bind="import-file"]').set_input_files(str(file_path.resolve()))
            terminal=page.wait_for_function('window.__r9MigrationQuota.terminal').json_value()
            page.wait_for_timeout(100)
            report['confirmations']=confirmations;report['terminalStatus']=terminal['status'];report['terminalNotice']=terminal['notice']
            report['terminalCurrent']=save_raw('terminal-current.json',terminal['current'])
            report['backups']={k:save_raw(f'backup-{i}.json',v) for i,(k,v) in enumerate(terminal['backups'].items())}
            persist()
            check('one native confirmation covered the actual r8 source replacement',len(confirmations)==1 and confirmations[0]['valid'])
            check('file witness binds this exact native selection and prior current bytes',terminal['selected']['trusted'] and terminal['selected']['priorRaw']==before['current'])
            check('every existing original remains byte-identical',all(terminal['backups'].get(k)==v for k,v in before['backups'].items()))
            new_backups={k:v for k,v in terminal['backups'].items() if k not in before['backups']}
            check('any additional backup is exactly the pre-import r9 original',all(v==before['current'] for v in new_backups.values()) and len(new_backups)<=1)
            if terminal['status']=='已导入并存入本地':
                accepted=json.loads(terminal['current'])
                expected={**incoming,'revision':9,'savedAt':accepted['savedAt'],'lastTickAt':accepted['lastTickAt'],
                          'state':{'buildingTemplates':{'nextTemplateId':1,'templates':[]},**incoming['state']}}
                expected_raw=page.evaluate('source=>JSON.stringify(source,null,2)',expected)
                check('successful replacement commits the entire exact native r9 envelope',terminal['current']==expected_raw)
                check('successful replacement retains the second exact original',len(new_backups)==1)
                updates=[event for event in current_events[current_start:] if event.get('newValue')==terminal['current']]
                check('native storage independently records exact old/new replacement bytes',len(updates)==1 and updates[0].get('oldValue')==before['current'])
                page.locator('[data-tab="overview"]').click()
                page.evaluate('() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                check('fresh visible UI adopts the incoming world only after commit',page.locator('[data-bind="ov-planet"]').text_content()==incoming['state']['planets'][0]['name'])
                report['result']='three-copy preservation succeeded'
            else:
                check('failure is a genuine native quota refusal',any(word in terminal['status'] for word in ('QuotaExceededError','quota','配额','空间','超出')),
                      {'status':terminal['status'],'notice':terminal['notice']})
                check('quota refusal leaves exact prior r9 current untouched',terminal['current']==before['current'] and not current_events[current_start:])
                page.locator('[data-tab="overview"]').click()
                page.evaluate('() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                shown=page.locator('[data-bind="ov-planet"]').text_content()
                check('fresh visible UI after quota refusal never adopts the replacement world',shown==before['planet'] and shown!=incoming['state']['planets'][0]['name'])
                protected_queue=page.evaluate(queue_probe)
                page.wait_for_timeout(1400)
                page.locator('[data-tab="facilities"]').click();page.locator('[data-tab="overview"]').click()
                page.evaluate('() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                waited_queue=page.evaluate(queue_probe)
                check('fresh full paid queue projection remains frozen after native time that advanced it while healthy',exact(waited_queue,protected_queue))
                # Explicit adversarial replay of a previously live paid-queue node;
                # no clock, storage or engine API is replaced or injected.
                replay=page.evaluate("""() => {const button=window.__quotaStaleCancel;if(!button||!button.isConnected)return false;
                  button.disabled=false;button.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;}""")
                check('captured formerly live paid cancel action was actually replayed',replay)
                page.locator('[data-tab="facilities"]').click();page.locator('[data-tab="overview"]').click()
                page.evaluate('() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                rejected_queue=page.evaluate(queue_probe);frozen=page.evaluate('window.__r9MigrationQuota.snapshot()')
                check('protected action cannot cancel, advance or otherwise change any paid queue',exact(rejected_queue,protected_queue))
                check('protected time and action replay retain all exact native bytes',frozen['current']==terminal['current'] and frozen['backups']==terminal['backups'] and not current_events[current_start:])
                report['protectedPaidQueueCanary']={'initial':protected_queue,'afterNativeWait':waited_queue,'afterStaleAction':rejected_queue,'nativeWaitMs':1400}

                page.locator('[data-tab="save"]').click()
                with page.expect_download() as download: page.locator('[data-action="export"]').click()
                exported=download.value;path=out/'protected-export.json';exported.save_as(path)
                check('protected export is exactly the pre-import r9 original',path.read_text()==before['current'])
                report['result']='native quota refusal protected both originals'
            for request,row in script_responses:
                final=request;seen=set()
                while final.redirected_to is not None:
                    check('script redirect chain is bounded and acyclic',final.url not in seen and len(seen)<20)
                    seen.add(final.url);final=final.redirected_to
                terminal_script=next((observed for req,observed in script_responses if req==final),None)
                check('every script response closes to a complete verified final HTTP 200 body',terminal_script is not None and terminal_script['status']==200 and terminal_script['verified'])
                row['finalUrl']=final.url
            check('actual page loaded at least one verified production script',any(row['verified'] for row in report['executedScripts']))
            check('no browser JavaScript errors or failed requests',not report['errors'])
            page.screenshot(path=str(out/'terminal.png'),full_page=True,timeout=5000)
            report['completed']=True;persist()
        except BaseException as error:
            report['result']='failed';report['error']=repr(error);report['traceback']=traceback.format_exc();persist()
            if page is not None:
                try: page.screenshot(path=str(out/'failure.png'),full_page=True,timeout=2000)
                except Exception as capture_error: report['captureError']=str(capture_error)
            raise
        finally:
            if browser is not None:
                try: browser.close()
                except Exception as error: report['cleanupError']=str(error)
            persist()

if args.worker:
    worker()
else:
    persist()
    with (out/'worker.log').open('w') as log:
        process=subprocess.Popen([sys.executable,__file__,*sys.argv[1:],'--worker'],stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        try: code=process.wait(timeout=100)
        except subprocess.TimeoutExpired:
            try: os.killpg(process.pid,signal.SIGTERM)
            except ProcessLookupError: pass
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try: os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError: pass
                process.wait(timeout=2)
            try: report=json.loads(report_path.read_text())
            except Exception: pass
            report.update(completed=False,result='external watchdog timeout',timeoutSeconds=100)
            persist();code=1
    sys.exit(code)
