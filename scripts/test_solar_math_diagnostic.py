"""Static fail-closed contracts; no Node/browser or application state is run."""
import importlib.util
import json
import re
import signal
import sys
import tempfile
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace
import unittest

FILE=Path(__file__).with_name('diagnose-solar-browser.py')
spec=importlib.util.spec_from_file_location('solar_math_diagnostic',FILE)
D=importlib.util.module_from_spec(spec);spec.loader.exec_module(D)

class SolarMathDiagnosticTests(unittest.TestCase):
    def test_rejects_changed_compiled_original(self):
        with self.assertRaisesRegex(AssertionError,'original verified compiled bundle'):
            D.instrument(SimpleNamespace(http_bytes=b'changed'), 'function solarMathProbe(){}')

    def test_diagnostic_does_not_modify_production_files_or_native_math(self):
        helper=FILE.with_name('solar-math-probe.mjs').read_text()
        self.assertNotIn('Math.pow =',helper)
        self.assertNotIn('state.planets[0].resources.deuterium =',helper)
        self.assertNotIn('prototype.add =',helper)
        self.assertIn('isolated arithmetic counterfactual, never adopted',helper)
        self.assertIn('3ff76cf41f212d79',helper)
        self.assertIn('3ff76cf41f212d7a',helper)

    def test_workflow_pins_original_runtimes_and_evidence(self):
        workflow=(FILE.parents[1]/'.github/workflows/solar-math-diagnostic.yml').read_text()
        for value in ['node-version: 22.23.3','154.0.8037.97','run-id: 38496521976',D.SHA,'timeout-minutes: 10']:
            self.assertIn(value,workflow)
        self.assertNotIn('contents: write',workflow)
        self.assertNotIn('git push',workflow)
        native=workflow.split('      - name: Observe exact original native prefix and numerical operands\n',1)[1].split('      - uses:',1)[0]
        step_seconds=int(re.search(r'timeout-minutes: (\d+)',native).group(1))*60
        readiness=int(re.search(r'for attempt in \$\(seq 1 (\d+)\)',native).group(1))
        kill_after,outer=map(int,re.search(r'--kill-after=(\d+)s (\d+)s python',native).groups())
        self.assertLess(readiness+outer+kill_after,step_seconds)
        self.assertEqual((readiness,outer,kill_after,step_seconds),(15,170,5,240))

class SolarSupervisorTests(unittest.TestCase):
    def test_exact_supervisor_adapter_is_scoped_and_restored(self):
        budgets={'solar':600};seen=[]
        original=SimpleNamespace(__file__='original.py',BUDGETS=budgets,S=SimpleNamespace(BUDGET=600))
        def run(args):
            seen.append((original.__file__,original.BUDGETS.copy(),original.S.BUDGET,args.lane))
            return 1
        original.supervise=run
        self.assertEqual(D.supervise(SimpleNamespace(lane='solar'),original),1)
        self.assertEqual(seen,[(str(FILE.resolve()),{'solar':140},600,'solar')])
        self.assertEqual(original.__file__,'original.py');self.assertIs(original.BUDGETS,budgets)
        def fail(args): raise ValueError('injected supervisor failure')
        original.supervise=fail
        with self.assertRaisesRegex(ValueError,'injected'):D.supervise(SimpleNamespace(lane='solar'),original)
        self.assertEqual(original.__file__,'original.py');self.assertIs(original.BUDGETS,budgets)

    def test_original_timeout_records_only_observed_owned_processes(self):
        # Execute the exact supervisor with a model process tree. No subprocess,
        # browser, signal delivery, or global process inspection actually occurs.
        sys.path.insert(0,str(FILE.parent))
        spec=importlib.util.spec_from_file_location('solar_supervisor_model',FILE.with_name('browser-energy-challenge-solar.py'))
        original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)
        statuses={10:{'pid':10,'start':100,'state':'S'},20:{'pid':20,'start':200,'state':'S'}}
        commands=[];kills=[];waits=[];ticks=iter([0,157]);marker='--energy-challenge-owner=model'
        class VirtualProc:
            def __init__(self,path):self.path=path;self.name=path.rsplit('/',1)[-1]
            def __truediv__(self,name):return VirtualProc(self.path+'/'+name)
            def iterdir(self):return [VirtualProc('/proc/20')]
            def read_bytes(self):return marker.encode()+b'\0'
            def glob(self,pattern):return []
        def paths(value):return VirtualProc(value) if str(value).startswith('/proc') else Path(value)
        class Child:
            pid=10
            def poll(self):return None if statuses[10]['state']=='S' else -15
            def wait(self,timeout):waits.append(timeout);return -15
        def launch(command,**kwargs):commands.append(command);return Child()
        def identity(pid):return dict(statuses[pid]) if pid in statuses else None
        def kill(pid,sig):
            kills.append((pid,sig))
            if pid==10 or sig==signal.SIGKILL:statuses[pid]['state']='Z'
        with tempfile.TemporaryDirectory() as root:
            out=Path(root)/'output'
            with patch.object(original,'Path',paths),patch.object(original,'process_identity',identity),patch.object(original.subprocess,'Popen',launch),patch.object(original.os,'kill',kill),patch.object(original.signal,'signal'),patch.object(original.time,'monotonic',side_effect=lambda:next(ticks)),patch.object(original.uuid,'uuid4',return_value=SimpleNamespace(hex='model')):
                self.assertEqual(D.supervise(SimpleNamespace(output=str(out),lane='solar'),original),1)
            report=json.loads((out/'supervisor.json').read_text())
            self.assertTrue(report['expired']);self.assertEqual(report['budgetSeconds'],160)
            self.assertEqual(report['survivors'],[])
            self.assertEqual({r['pid'] for r in report['ownedProcesses']},{10,20})
            self.assertEqual({r['pid'] for r in report['signals']},{10,20})
            self.assertIn((20,signal.SIGTERM),kills);self.assertIn((20,signal.SIGKILL),kills)
            self.assertEqual(waits,[2,2])
            self.assertEqual(commands[0][1],str(FILE.resolve()))
            self.assertIn('--owner-marker='+marker,commands[0])
            self.assertTrue((out/'seal.json').is_file())
        self.assertEqual(original.BUDGETS,{'solar':600})

if __name__=='__main__': unittest.main()
