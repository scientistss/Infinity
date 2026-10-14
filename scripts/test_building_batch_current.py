"""Exact current batch envelope/release boundaries, independent of production readers."""
import ast
import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('current_batch_fixture_checker', ROOT / 'scripts/check-building-batch-fixture.py')
CHECKER = importlib.util.module_from_spec(spec); spec.loader.exec_module(CHECKER)


def envelope():
    return {'version':9, 'revision':16, 'state':{'energyChallenge':{'model':'energy-tightening-v1',
        'nextAttemptId':1, 'active':None, 'completion':None}, 'planets':[{'id':'homeworld'},{'id':'colony-1'}]}}


class CurrentBatchEvidence(unittest.TestCase):
    def test_exact_inactive_current_envelope_is_retained_without_projection(self):
        value = envelope(); original = copy.deepcopy(value)
        CHECKER.assert_current_envelope(value)
        self.assertEqual(value, original)

    def test_old_future_or_retagged_envelopes_are_rejected(self):
        for revision in (14, 15, 17, '16', 16.0, True, None):
            value = envelope(); value['revision'] = revision
            with self.subTest(revision=revision), self.assertRaises(AssertionError):CHECKER.assert_current_envelope(value)
        for version in (8, 10, '9', 9.0, True):
            value = envelope(); value['version'] = version
            with self.subTest(version=version), self.assertRaises(AssertionError):CHECKER.assert_current_envelope(value)

    def test_missing_extra_misplaced_or_earned_challenge_state_is_not_ignored(self):
        changes = [lambda s:s.pop('energyChallenge'),
                   lambda s:s['energyChallenge'].update(nextAttemptId=2),
                   lambda s:s['energyChallenge'].update(active={'attemptId':1}),
                   lambda s:s['energyChallenge'].update(completion={'attempt':{}}),
                   lambda s:s['energyChallenge'].update(extra=None),
                   lambda s:s['energyChallenge'].update(model='unknown'),
                   lambda s:s.update(protocols={'energyChallenge':copy.deepcopy(s['energyChallenge'])}),
                   lambda s:s.update(protocols={'model':'energy-tightening-v1'})]
        for mutation in changes:
            value=envelope(); mutation(value['state'])
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):CHECKER.assert_current_envelope(value)

    def test_all_original_checkpoint_boundary_and_lifecycle_envelopes_are_checked(self):
        tree = ast.parse((ROOT/'scripts/check-building-batch-fixture.py').read_text())
        validate = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='validate')
        calls=[ast.unparse(n) for n in ast.walk(validate) if isinstance(n,ast.Call)
               and isinstance(n.func,ast.Name) and n.func.id=='assert_current_envelope']
        self.assertEqual(sorted(calls), sorted(['assert_current_envelope(envelope)',
            'assert_current_envelope(branch[envelope_key])', "assert_current_envelope(branch['envelope'])"]))
        source=(ROOT/'scripts/building-batch-natural-fixture.mjs').read_text()
        self.assertIn('SAVE_REVISION',source)
        self.assertIn('exportSave',source)
        self.assertNotIn('revision: 16',source)  # producer uses the real serializer, never a label patch

    def test_actual_browser_release_predicate_requires_current_source_version_revision_and_http(self):
        path=ROOT/'scripts/browser-building-batch.py';tree=ast.parse(path.read_text())
        predicates=[n.args[1] for n in ast.walk(tree) if isinstance(n,ast.Call)
            and isinstance(n.func,ast.Name) and n.func.id=='check' and len(n.args)>1
            and isinstance(n.args[0],ast.Constant) and n.args[0].value=='release exact SHA version and unchanged schema']
        self.assertEqual(len(predicates),1)
        code=compile(ast.Expression(predicates[0]),str(path),'eval')
        base={'sourceSha':'a'*40,'version':'0.6.32-alpha.1','saveVersion':9,'saveRevision':16}
        scope={'release':base,'args':SimpleNamespace(expected_sha='a'*40,expected_version='0.6.32-alpha.1'),'response':SimpleNamespace(status=200)}
        self.assertTrue(eval(code,scope))
        for key,value in [('sourceSha','b'*40),('version','0.6.31-alpha.1'),('saveVersion',8),('saveRevision',14),('saveRevision',15),('saveRevision',17)]:
            with self.subTest(key=key,value=value):
                self.assertFalse(eval(code,{**scope,'release':{**base,key:value}}))
        self.assertFalse(eval(code,{**scope,'response':SimpleNamespace(status=304)}))
        self.assertFalse(eval(code,{**scope,'release':{**base,'version':'0.6.31-alpha.1'},
            'args':SimpleNamespace(expected_sha='a'*40,expected_version='0.6.31-alpha.1')}))


if __name__=='__main__':unittest.main()
