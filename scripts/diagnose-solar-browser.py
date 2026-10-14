#!/usr/bin/env python3
"""Read-only operand observation on the original native first-117-event route.

This is a diagnostic, never a solar acceptance pass. The unmodified source worker
retains genuine initial Save/Reload, paid clicks, positive frames and whole-state
comparisons. Only its observer gains pure numeric reads; route stops at event 117.
"""
import argparse
from dataclasses import replace
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
from types import SimpleNamespace

SHA = '309ec2037c0f4412c913d07bc7263d4f83b1f153'
BUNDLE_SHA = '45b064cc53431b87ed312dd5fecf450c5d5085485a42b620dce5b978cb173df9'
CHROME = '154.0.8037.97'
def digest(raw): return hashlib.sha256(raw).hexdigest()
def write(path, value):
    with path.open('x') as f: json.dump(value, f, indent=2); f.write('\n')

def instrument(plan, helper):
    assert digest(plan.http_bytes) == BUNDLE_SHA, 'Only the original verified compiled bundle is supported'
    # These bindings are read only after the complete original bytes are pinned.
    assert 'const Ri=e=>e*Math.pow(1.1,e)' in plan.source
    assert 'function qg(e){return e<=0?0:20*Ri(e)}' in plan.source
    assert 'function xt(e){const t=$$(e),n=Co(e),r=q(e).resources;' in plan.source
    probes=[]
    for p in plan.probes:
        if p.kind == 'frame':
            gap=re.search(r'gapSeconds:([A-Za-z_$][A-Za-z0-9_$]*)',p.payload).group(1)
            payload=p.payload+f',solarMath:({gap}===1&&V.totalTime.eq(98)?({helper})(V,xt(V),M,qg):null)'
            payload+=f',solarBeforeState:({gap}===1&&V.totalTime.eq(98)?Lo(V):null)'
            p=replace(p,payload=payload)
        probes.append(p)
    return replace(plan,probes=tuple(probes))

def supervise(args, original):
    """Reuse the exact original marker/PID-start supervisor for this diagnostic.

    Its existing +20 envelope and two 2-second cleanup waits give a 156-second
    execution deadline and 160-second owned-process envelope here. Only this
    imported diagnostic instance is scoped; the source and formal 600s stay intact.
    """
    old_file, old_budgets = original.__file__, original.BUDGETS
    try:
        original.__file__ = str(Path(__file__).resolve())
        original.BUDGETS = {'solar': 140}
        return original.supervise(args)
    finally:
        original.__file__, original.BUDGETS = old_file, old_budgets

def main():
    p=argparse.ArgumentParser()
    for name in ('source','artifact','url','chromium','node-report','output'):p.add_argument('--'+name,required=True)
    p.add_argument('--worker',action='store_true');p.add_argument('--run-id');p.add_argument('--owner-marker')
    args=p.parse_args();args.lane='solar';source=Path(args.source).resolve();artifact=Path(args.artifact).resolve();out=Path(args.output).resolve()
    sys.path.insert(0,str(source/'scripts'))
    spec=importlib.util.spec_from_file_location('original_solar_worker',source/'scripts/browser-energy-challenge-solar.py')
    worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
    if not args.worker: return supervise(args,worker)
    assert args.run_id and args.owner_marker=='--energy-challenge-owner='+args.run_id
    assert out.is_dir(), 'Only the owning supervisor creates the diagnostic output'
    native_out=out/'partial-native';native_out.mkdir()
    browser_path=Path(args.chromium).resolve()
    browser_version=subprocess.check_output([str(browser_path),'--version'],text=True).strip()
    assert CHROME in browser_version, f'Original Chrome {CHROME} required, found {browser_version}'
    assert subprocess.check_output(['node','--version'],text=True).strip() == 'v22.23.3'
    helper=(Path(__file__).with_name('solar-math-probe.mjs')).read_text().split('export ',1)[1].strip()
    original_plan=worker.S.prepare_trace
    worker.S.prepare_trace=lambda *values:instrument(original_plan(*values),helper)
    original_inputs=worker.S.load_inputs
    def prefix(*values):
        natural,route,events,oracle,expected,initial=original_inputs(*values)
        return natural,route,events[:117],oracle,expected[:117],initial
    worker.S.load_inputs=prefix
    OriginalTrace=worker.NativeFrameTrace
    class DiagnosticTrace(OriginalTrace):
        def install(self):
            self.browser_runtime=self.cdp.send('Browser.getVersion')
            self.browser_command_line=self.cdp.send('Browser.getBrowserCommandLine')
            super().install()
        def snapshot(self): return {**super().snapshot(),'browserRuntime':self.browser_runtime,'browserCommandLine':self.browser_command_line}
    worker.NativeFrameTrace=DiagnosticTrace
    run_id=args.run_id
    options=SimpleNamespace(output=str(native_out),natural=str(artifact/'energy-solar-evidence/natural'),oracle=str(artifact/'energy-solar-evidence/oracle/manifest.json'),expected_sha=SHA,runtime_node='v22.23.3',common_identity=str(artifact/'energy-solar-evidence/000000-common-identity.json'),run_id=run_id,expected_version='0.6.32-alpha.1',url=args.url,chromium=str(browser_path),owner_marker=args.owner_marker,node='node',lane='solar')
    code=worker.worker(options)
    report=json.loads((native_out/'report.json').read_text())
    assert code==1 and report['completed'] is False, 'A diagnostic cannot claim full acceptance'
    assert report['failure']['eventIndex']==117, report.get('failure')
    trace_path=native_out/report['failure']['trace']['file'];raw=trace_path.read_bytes()
    assert digest(raw)==report['failure']['trace']['sha256']
    trace=json.loads(raw);assert not trace['failures']
    observations=[e for e in trace['events'] if e.get('solarMath')]
    assert len(observations)==1
    before=observations[0]
    after=next(e for e in trace['events'][before['sequence']+1:] if e['kind']=='frame-end' and e.get('state'))
    old=json.loads((artifact/'energy-solar-evidence/000076-failure-trace.json').read_text())
    node=json.loads(Path(args.node_report).read_text())
    assert before['solarBeforeState']==old['events'][1029]['state']==node['event116State']
    assert after['state']==old['events'][1033]['state']
    assert node['matchesOracle'], 'Node22 original complete event117 state changed'
    assert node['deuterium']['actual']==node['deuterium']['oracle']=='9.93352282757144'
    assert before['solarMath']['add']['result']['string']==after['state']['planets'][0]['resources']['deuterium']=='9.93352282757143'
    assert before['solarMath']['powers']['4']['bits']=='3ff76cf41f212d79'
    assert node['event117Operands']['powers']['4']['bits']=='3ff76cf41f212d7a'
    assert before['solarMath']['variants'][1]['result']['string']==node['deuterium']['actual']
    records=[json.loads(line) for line in (native_out/'route-records.jsonl').read_text().splitlines()]
    assert len(records)==116 and [r['index'] for r in records]==list(range(1,117))
    result={'schema':'infinity-solar-runtime-math-diagnosis-v1','classification':'read-only diagnosis, not solar acceptance','status':'cause-reproduced','sourceSha':SHA,'originalRunId':38496521976,'browserVersion':browser_version,'browserExecutable':{'path':str(browser_path),'sha256':digest(browser_path.read_bytes())},'browserRuntime':trace['browserRuntime'],'browserCommandLine':trace['browserCommandLine'],'originalBundleSha256':BUNDLE_SHA,'actualExecutedSources':trace['executedScripts'],'trace':{'file':str(trace_path.relative_to(out)),'sha256':digest(raw)},'matchedPrefixEvents':116,'firstDifferenceEvent':117,'browserOperands':before['solarMath'],'nodeOperands':node['event117Operands'],'originalStateReferences':{'traceSha256':digest((artifact/'energy-solar-evidence/000076-failure-trace.json').read_bytes()),'beforeSequence':1029,'afterSequence':1033},'conclusion':'Original engines differ by one ULP in Math.pow(1.1,4), crossing Decimal.add rounding boundary; no Save/Reload or tick-count divergence.'}
    write(out/'diagnosis.json',result)
    print(json.dumps({'status':result['status'],'output':str(out/'diagnosis.json')}))
    return 0
if __name__=='__main__': raise SystemExit(main())
