#!/usr/bin/env python3
"""Stdlib-only supervisor/partial-evidence tests. Never native CPU evidence."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('active_runner', Path(__file__).with_name('browser-energy-active-performance.py'))
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class RunnerTests(unittest.TestCase):
    def setUp(self):
        # Honor workspace-only scratch rather than assuming /tmp capacity.
        self.temporary = tempfile.TemporaryDirectory(prefix='energy-runner-unit-', dir=Path(__file__).resolve().parents[2])
        self.directory = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def recorder(self):
        args = types.SimpleNamespace(output=str(self.directory), invocation_id='unit-test')
        with contextlib.redirect_stdout(io.StringIO()):
            return RUNNER.Recorder(args)

    def test_fixed_plan_includes_all_cells_before_browser(self):
        recorder = self.recorder()
        runs = recorder.report['runs']
        self.assertEqual(len(runs), 12)
        self.assertEqual(sum(len(run['windows']) for run in runs), 36)
        for profile in RUNNER.PROFILES:
            self.assertEqual([run['variant'] for run in runs if run['profile'] == profile],
                             ['active', 'control', 'control', 'active', 'active', 'control'])
        self.assertTrue(all(not run['started'] and not run['qualified'] for run in runs))
        self.assertEqual((RUNNER.WARMUP_MS, RUNNER.SAMPLE_MS), (600, 2000))
        self.assertEqual((RUNNER.PHASE_TIMEOUT_SECONDS, RUNNER.WHOLE_TIMEOUT_SECONDS), (90, 480))

    def test_storage_manifest_keeps_exact_current_and_backup_bytes(self):
        recorder = self.recorder()
        snapshot = {'currentRaw': '{"current":1}\n', 'backups': [{'key': 'save.backup.1', 'raw': '{"prior":0}'}],
                    'readStartedAt': 1, 'readEndedAt': 2}
        stored = recorder.storage('sample', snapshot)
        self.assertEqual(len(recorder.strict_inputs), 2)
        for ref, expected in [(stored['current'], snapshot['currentRaw']), (stored['backups'][0]['raw'], snapshot['backups'][0]['raw'])]:
            self.assertEqual((self.directory / ref['file']).read_text(), expected)
            self.assertEqual(ref['sha256'], RUNNER.sha(expected))
        with contextlib.redirect_stdout(io.StringIO()): recorder.phase('persist')
        self.assertEqual(json.loads((self.directory / 'strict-reader-inputs.json').read_text())['files'], recorder.strict_inputs)

    def test_missing_metric_rejected_and_no_metric_invented(self):
        with self.assertRaisesRegex(AssertionError, 'missing/nonfinite'):
            RUNNER.metric_values({'metrics': [{'name': 'Timestamp', 'value': 1}]})
        self.assertEqual(RUNNER.summary([])['median'], None)

    def test_returned_start_counter_survives_end_counter_exception(self):
        recorder = self.recorder(); window = recorder.report['runs'][0]['windows'][0]
        before = {'metrics': [{'name': 'Timestamp', 'value': 7}]}
        class FailingCdp:
            def __init__(self): self.calls = 0
            def send(self, _):
                self.calls += 1
                if self.calls == 1: return before
                raise RuntimeError('injected end-counter failure')
        page = types.SimpleNamespace(wait_for_timeout=lambda _: None)
        with patch.object(RUNNER, 'observed_save', return_value=({}, {'after': {'now': 0}}, {})), \
             patch.object(RUNNER, 'navigate', return_value={}), \
             patch.object(RUNNER, 'light', return_value={'now': 1}), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, 'end-counter failure'):
                RUNNER.collect_window(recorder, page, FailingCdp(), window)
        self.assertFalse(window['metricBlockCompleted'])
        self.assertFalse(window['completed'])
        self.assertNotIn('metricsAfter', window)
        self.assertNotIn('afterMarker', window)
        self.assertIsNone(window['hostWindow']['afterEndCounter'])
        self.assertEqual(json.loads((self.directory / window['metricsBefore']['file']).read_text()), before)

    def test_supervisor_retains_plan_when_worker_dies_before_recorder(self):
        for remove_report in (False, True):
            with self.subTest(remove_report=remove_report):
                directory = self.directory / str(remove_report); directory.mkdir()
                code = "import sys;from pathlib import Path;" + ("Path(sys.argv[1]).unlink();" if remove_report else "") + "sys.exit(13)"
                result_code = RUNNER.supervise([sys.executable, '-c', code, str(directory / 'report.json')],
                                               directory, 'pre-recorder', phase_timeout=.5, whole_timeout=2)
                result = json.loads((directory / 'report.json').read_text())
                self.assertEqual(result_code, 13)
                self.assertEqual(result['runs'], RUNNER.planned_runs())
                self.assertEqual(len(result['runs']), 12)
                self.assertEqual(sum(len(run['windows']) for run in result['runs']), 36)
                self.assertFalse(result['completed'])
                self.assertFalse(result['qualified'])
                self.assertTrue(result['errors'])
                self.assertEqual(result['supervisor']['workerExitCode'], 13)

    def test_supervisor_success_exit_stall_and_detached_cleanup(self):
        code = r'''import json,signal,subprocess,sys,time
from pathlib import Path
p=Path(sys.argv[1]);token=sys.argv[2];name=sys.argv[3]
signal.signal(signal.SIGUSR1,lambda *_:None)
def progress(): (p/'progress.json').write_text(json.dumps({'invocationId':token,'monotonic':time.monotonic(),'phase':name}))
progress()
(p/'report.json').write_text(json.dumps({'completed':name=='healthy','qualified':name=='healthy','runs':[{'completed':name=='healthy','qualified':name=='healthy'}],'errors':['original-error']}))
if name in ('stall','whole'):
 child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],start_new_session=True)
 (p/'owned.pid').write_text(str(child.pid))
 while True:
  if name=='whole':progress()
  time.sleep(.05)
sys.exit(7 if name=='exit7' else 0)
'''
        for name, expected, reason in [('healthy', 0, None), ('exit7', 7, None),
                                      ('stall', 124, 'phase-stall-timeout'), ('whole', 124, 'whole-worker-timeout')]:
            with self.subTest(name=name):
                directory = self.directory / name; directory.mkdir()
                actual = RUNNER.supervise([sys.executable, '-c', code, str(directory), name, name], directory, name,
                                          phase_timeout=.5, whole_timeout=.8)
                result = json.loads((directory / 'report.json').read_text())
                self.assertEqual(actual, expected)
                self.assertEqual(result['supervisor']['timeoutReason'], reason)
                self.assertTrue(result['supervisor']['cleanup']['noObservedLiveOwnedDescendants'])
                self.assertIn('original-error', result['errors'])
                self.assertEqual(result['qualified'], name == 'healthy')
                if reason:
                    pid = int((directory / 'owned.pid').read_text())
                    identity = RUNNER.process_identity(pid)
                    self.assertTrue(identity is None or identity['state'] == 'Z')
                    self.assertFalse(result['runs'][0]['qualified'])


if __name__ == '__main__':
    unittest.main()
