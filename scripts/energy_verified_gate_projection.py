"""B-only pure historical gate mapping after a fresh per-call sealed capture.

The six helpers are exact finite replacements against the approved solar source
checkpoint. All new modules and wiring have complete independent support rows.
Successful mapping performs no external reads and retains no cross-call inputs.
This input mechanism is not native, CI or release acceptance by itself.

The old low-level LRU APIs remain unchanged. Their warm historical reads are not
adopted as acceptance evidence: every new helper call captures again. No old-to-new
warm-cache benchmark or game/runtime speedup is claimed by this source change.

Capture intentionally reports the first changed tracked input before historical
projection. Four approved first-error changes are explicitly exercised by
RealProjectionTests.test_original_and_capture_first_errors_are_preserved_explicitly:
workflow newline, package newline, dependency bytes, and combined workflow plus
diagnostic drift. The original helpers' actual first errors are checked alongside
the new capture errors; the legacy test methods and low-level APIs are preserved.
"""
import ast
import pprint
from pathlib import Path

import energy_challenge_source_pins as pins
import energy_challenge_workflow as energy
import energy_challenge_solar_workflow as solar
import test_building_batch_gate as batch
import test_research_unlock_copy_gate as research
import test_fleet_row_gate as fleet
import test_recycle_preview_gate as recycle
import test_manual_unit_gate as manual
import test_lab_blockers_gate as lab
from energy_verified_input import capture, sha

PREDECESSOR = 'a3e340a28e55eea56859f1db3ccc0e24543f0cf6'
MANIFEST = 'tests/fixtures/energy-challenge-provenance.json'
PIN_FILE = 'scripts/energy_challenge_source_pins.py'
SOLAR_SOURCE = 'scripts/energy_challenge_solar_workflow.py'
SOLAR_TEST = 'scripts/test_energy_challenge_solar_gate.py'
VERIFIED_INPUT_ANCHOR = "          python -m unittest discover -s scripts -p 'test_research_unlock_copy_browser.py' -v\n"
VERIFIED_INPUT_COMMAND = "          python -m unittest discover -s scripts -p 'test_energy_verified_input.py' -v\n"

SOURCE_FOLLOWUP_ROWS = {'docs/ENERGY_CHALLENGE_DOMAIN_STATUS.md': {'before': '2e6cdf526dcc62642f0d29bd489ad23d3c21ecf6e6cb61739287cdae49271a5a',
                                            'after': 'f5c8dff917dc0c6d79bd54d1d13d6e77645de479b6e8db8a256ae3a6869dcec6'},
 'scripts/browser-energy-challenge-solar.py': {'before': 'cc98de66ac040d4e13775fa1e29e9640e0a3253a053b9a0270aab679bbc9552d',
                                               'after': '699273661b49ae5e3b4326af94332b58efa39aabc2fde0e0c85b03598abb5d3c'},
 'scripts/browser-energy-challenge.py': {'before': 'e125a0c0e821256ef02d81223b19815a1978e3eac6a6f16685205193cbfff33b',
                                         'after': 'd7753666ce3909f7cbdb13d6810f3205f4347d4cf16e1b756f7786d9ce1b8de4'},
 'scripts/browser-lab-blockers.py': {'before': 'f8d5504136e49b2dbc0ccbef64a3aa42e398bc85c55974b64c1123852cd4349a',
                                     'after': '4c03ded286c18b4114c953c3d7cdfb28c234ba95825d43c60cc35b9d1ff59016'},
 'scripts/energy_challenge_census.py': {'before': 'cf91b2a1f5cfe0576836e16de3d913b22265416463d2d5996276799e9afdbb45',
                                        'after': '940ee72beae89b4d7a7dd1419876b04e0f671d0f278ff77ff6f2100ec31b2a9a'},
 'scripts/energy_challenge_solar_census.py': {'before': 'c3e08c3c47cac5d224411085c5482bede6b775ae8f7f1defb7e215b45b4f6951',
                                              'after': '703e101353c2715f58a2341c22c5b98ff6bf0aea2a7c8897137b474113f157f7'},
 'scripts/test_demolition_native_preparation.py': {'before': 'c26f7176ffe3e7b0e387fd4188fe8eab4a6a651a14f0c12f6e50475732574da1',
                                                   'after': '87cf5e4a92149e555b76e99eb32c02a9c32af687d311ea35812ecfdddc17f920'},
 'scripts/test_energy_challenge_native.py': {'before': 'd732a12db51d1f9eba6f00409fabb36f85cfe571146ca1fef8eb83243a7cbf24',
                                             'after': 'e2bccd22fa9acc03d74ccd41f4bf049d9f2de3afa35aa6b3343d046d2a68cdd5'},
 'scripts/test_energy_challenge_solar.py': {'before': '110263180c0d1786bfebebef0827a082dc18922d3364ccb95a49a86f46be2447',
                                            'after': '4df675435bf402f1d2be26c7fa8db2c7ce953d13fdb65c7b267a538e6fd8d3f9'},
 'scripts/test_energy_challenge_solar_gate.py': {'before': '11c0f1386e952428a330089028d9cb98e54887e2fd4414a35a2ed7ac5b17f3d0',
                                                 'after': '6dd0cde5229e53c660dc183d79eb3b49147d84b18fe7b8769f2d4a28bfc347ab'},
 'scripts/test_lab_blockers_acceptance.py': {'before': '4676ffc6004806ad5394453883f969705e8366f621d4a3eee8b0bdabdff6010e',
                                             'after': '4124d797037dc05d6c27f3a67727362e87bda6579b9bab56f50b8d51f5c59904'},
 'scripts/test_npc_attack_acceptance.py': {'before': 'dc2e0aee70a0f4911fb00a8bdfd4e41f20d839516726617f7bc73fcdb2145ab7',
                                           'after': '484ad50b958abdb465361d037a5d9fcc3904e5063ac645ed831bebd1a55ca40f'}}
RELEASE_FILES = tuple(batch.RELEASE_FILES)
NEW_PATH_MODES = {
    'scripts/energy-challenge-solar-browser-reference.mjs': '100644',
    'scripts/energy-challenge-solar-browser-reference.ts': '100644',
    'scripts/energy_challenge_solar_reference.py': '100644',
    'scripts/energy_verified_gate_projection.py': '100644',
    'scripts/energy_verified_input.py': '100644',
    'scripts/test-energy-challenge-solar-reference.mjs': '100644',
    'scripts/test_energy_challenge_solar_reference.py': '100644',
    'scripts/test_energy_verified_input.py': '100644',
}
NEW_PATHS = set(NEW_PATH_MODES)
ADAPTERS = {
    'scripts/test_manual_unit_gate.py': {
        'previous_six_workflow': ('workflow=None', "'manual_six', ROOT, workflow"),
        'previous_workflow': ('workflow=None', "'manual_workflow', ROOT, workflow"),
        'previous_release_bytes': ('path', "'manual_release', ROOT, path"),
    },
    'scripts/test_lab_blockers_gate.py': {
        'assert_release_transitions': ('', "'lab_transitions', ROOT"),
        'previous_workflow': ('workflow=None', "'lab_workflow', ROOT, workflow"),
        'previous_release_bytes': ('relative', "'lab_release', ROOT, relative"),
    },
}
NEW_HISTORICAL_SUPPORT = set(ADAPTERS) | {'scripts/test_demolition_native_preparation.py'}
OPERATIONS = {'manual_six', 'manual_workflow', 'manual_release',
              'lab_workflow', 'lab_release', 'lab_transitions'}


def adapted_source(path, raw):
    """Finite six-entry transform; every byte outside these helpers survives."""
    assert path in ADAPTERS
    text = raw.decode()
    lines = text.splitlines(keepends=True)
    found = {}
    for node in ast.parse(text).body:
        if isinstance(node, ast.FunctionDef) and node.name in ADAPTERS[path]:
            assert not node.decorator_list and node.name not in found
            signature, arguments = ADAPTERS[path][node.name]
            replacement = (f'def {node.name}({signature}):\n'
                           '    from energy_verified_gate_projection import call\n'
                           f'    return call({arguments})\n')
            found[node.name] = (node.lineno-1, node.end_lineno, replacement)
    assert set(found) == set(ADAPTERS[path]), 'Exact legacy entry set required'
    for start, end, replacement in sorted(found.values(), reverse=True):
        lines[start:end] = [replacement]
    return ''.join(lines).encode()


def support_assignment(raw):
    text = raw.decode()
    nodes = [node for node in ast.parse(text).body if isinstance(node, ast.Assign)
             and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
             and node.targets[0].id == 'SUPPORT_ROWS']
    assert len(nodes) == 1, 'One exact support-row assignment required'
    node = nodes[0]
    return text.splitlines(keepends=True), node, ast.literal_eval(node.value)


def updated_pin_source(raw, rows):
    lines, node, _ = support_assignment(raw)
    lines[node.lineno-1:node.end_lineno] = ['SUPPORT_ROWS = '+pprint.pformat(rows, width=120, sort_dicts=False)+'\n']
    return ''.join(lines).encode()


def adapted_solar_source(raw):
    text = raw.decode()
    anchor = 'def expected_workflow(before=None):\n'
    constants = ('VERIFIED_INPUT_ANCHOR = '+repr(VERIFIED_INPUT_ANCHOR)+'\n'
                 'VERIFIED_INPUT_COMMAND = '+repr(VERIFIED_INPUT_COMMAND)+'\n\n\n')
    text = solar.exact(text, anchor, constants+anchor)
    anchor = '    current=exact(before,LAB_IMPORT_BEFORE,LAB_IMPORT_AFTER)\n'
    text = solar.exact(text, anchor, anchor+
        '    current=exact(current,VERIFIED_INPUT_ANCHOR,VERIFIED_INPUT_ANCHOR+VERIFIED_INPUT_COMMAND)\n')
    anchor = ('          (cd "$RUNNER_TEMP/energy-solar-current" && ENERGY_SOLAR_NATURAL="$GITHUB_WORKSPACE/energy-natural/report.json" '
              'node --import tsx --test scripts/test-energy-challenge-solar-oracle.mjs)\n')
    text = solar.exact(text, anchor, anchor+
        '          (cd "$RUNNER_TEMP/energy-solar-current" && node scripts/energy-challenge-solar-browser-reference.mjs '
        '--natural "$GITHUB_WORKSPACE/energy-natural/report.json" --out "$GITHUB_WORKSPACE/energy-solar-reference") '
        '> energy-solar-reference.log 2>&1\n'
        '          (cd "$RUNNER_TEMP/energy-solar-current" && ENERGY_SOLAR_NATURAL="$GITHUB_WORKSPACE/energy-natural/report.json" '
        'node --import tsx --test scripts/test-energy-challenge-solar-reference.mjs)\n')
    for before, after in (
        ('      - name: Mandatory continuous solar route, 600 seconds plus 20-second cleanup\n',
         '      - name: Mandatory solar reference preparation 60 seconds then native route 600 seconds and cleanup 20 seconds\n'),
        ('timeout --signal=TERM --kill-after=20s 600s xvfb-run -a python scripts/browser-energy-challenge-solar.py',
         'timeout --signal=TERM --kill-after=20s 660s xvfb-run -a python scripts/browser-energy-challenge-solar.py'),
        ('--oracle energy-solar-oracle/manifest.json --expected-sha',
         '--oracle energy-solar-oracle/manifest.json --browser-reference energy-solar-reference/manifest.json --expected-sha'),
        ('            energy-solar-oracle\n            energy-solar-evidence\n',
         '            energy-solar-oracle\n            energy-solar-reference\n            energy-solar-evidence\n'),
    ):
        text = solar.exact(text, before, after)
    return text.encode()


def requests():
    values = {PREDECESSOR: set(ADAPTERS) | set(SOURCE_FOLLOWUP_ROWS) | {PIN_FILE, SOLAR_SOURCE, SOLAR_TEST},
              solar.BASE_SHA: {energy.WORKFLOW_PATH},
              energy.BASE_SHA: {energy.WORKFLOW_PATH, *RELEASE_FILES, *NEW_HISTORICAL_SUPPORT}}
    for stage in (batch, research, fleet, recycle, manual, lab):
        values.setdefault(stage.BASE_SHA, set()).update((energy.WORKFLOW_PATH, *stage.RELEASE_FILES))
    values.setdefault(manual.SIX_BASE_SHA, set()).add(energy.WORKFLOW_PATH)
    values.setdefault(manual.DIAGNOSTIC_SHA, set()).update(manual.DIAGNOSTIC_FILES)
    values.setdefault(lab.CORRECTED_FORMATION_SHA, set()).update(lab.CORRECTED_FORMATION_VERSION_FILES)
    return values


def prepare(root):
    return capture(root, requests())


def verify_adoption_delta(value):
    before, after = value.histories[PREDECESSOR], value.histories[value.candidate]
    adopted = set(ADAPTERS) | NEW_PATHS | set(SOURCE_FOLLOWUP_ROWS) | {energy.WORKFLOW_PATH, SOLAR_SOURCE, SOLAR_TEST}
    assert set(after) == set(before) | NEW_PATHS, 'Exact adopted file inventory required'
    for path, mode in NEW_PATH_MODES.items():
        assert after[path][0] == mode, ('Ordinary pinned support source required', path)
    for path in before:
        if path in ADAPTERS:
            original = value.historical(PREDECESSOR, path)
            assert value.files[path] == adapted_source(path, original), ('Exact six-entry adaptation required', path)
            assert after[path][0] == before[path][0] == '100644'
        elif path not in adopted | {PIN_FILE}:
            assert after[path] == before[path], ('Unapproved adopted source change', path)
    assert value.files[SOLAR_SOURCE] == adapted_solar_source(value.historical(PREDECESSOR, SOLAR_SOURCE)), 'Exact solar workflow source adaptation required'
    for path, expected in SOURCE_FOLLOWUP_ROWS.items():
        assert after[path][0] == before[path][0] == '100644', ('Ordinary source follow-up mode required', path)
        assert sha(value.historical(PREDECESSOR, path)) == expected['before'], ('Exact source follow-up predecessor required', path)
        assert sha(value.files[path]) == expected['after'], ('Exact bounded solar source follow-up required', path)
    original_pins = value.historical(PREDECESSOR, PIN_FILE)
    _, _, previous_rows = support_assignment(original_pins)
    _, _, current_rows = support_assignment(value.files[PIN_FILE])
    assert current_rows == pins.SUPPORT_ROWS, 'Captured support rows differ from loaded independent pins'
    assert value.files[PIN_FILE] == updated_pin_source(original_pins, pins.SUPPORT_ROWS), 'Only exact SUPPORT_ROWS assignment may change'
    old = {item['path']: item for item in previous_rows}
    current = {item['path']: item for item in current_rows}
    assert len(current) == len(current_rows) and tuple(current) == tuple(sorted(current)), 'Unique ordered support rows required'
    assert set(current) == set(old) | NEW_PATHS | NEW_HISTORICAL_SUPPORT, 'Exact support row inventory required'
    for path, item in current.items():
        assert after[path][0] == '100644', ('Ordinary pinned support source required', path)
        assert item['after'] == {'mode': '100644', 'sha256': sha(value.files[path])}, ('Exact adopted support bytes required', path)
        if path not in adopted:
            assert item == old[path], ('Unapproved support row change', path)
        elif path in old:
            assert item['before'] == old[path]['before'], ('Historical support identity drift', path)
        elif path in NEW_PATHS:
            assert item['before'] is None, ('New support path has historical identity', path)
        else:
            assert path in NEW_HISTORICAL_SUPPORT, ('Unapproved new historical support row', path)
            original = value.historical(energy.BASE_SHA, path)
            assert item['before'] == {'mode': '100644', 'sha256': sha(original)}, ('Exact original helper support identity required', path)
    assert after[PIN_FILE][0] == '100644'


def manual_split(six, five):
    """The existing manual split assertions with both byte inputs explicit."""
    assert sha(six.encode()) == manual.SIX_BASE_WORKFLOW_SHA256
    assert six == manual.expected_workflow(five), 'Original six-to-five workflow contract differs'
    result = manual.exact_replace(six, manual.MANUAL_JOB, manual.split_job('payments')+manual.split_job('authority'))
    for before, after in (
        ('    needs: [verify, verify-continuation, npc-orbital, scout-rehearsal, lab-blockers, manual-unit-orders]\n',
         '    needs: [verify, verify-continuation, npc-orbital, scout-rehearsal, lab-blockers, manual-unit-payments, manual-unit-authority]\n'),
        ('      - name: Require all six jobs and exact source asset runtime and fixture identities\n',
         '      - name: Require all seven jobs and exact source asset runtime and fixture identities\n'),
        ("          assert set(jobs) == {'verify', 'verify-continuation', 'npc-orbital', 'scout-rehearsal', 'lab-blockers', 'manual-unit-orders'}, jobs\n",
         "          assert set(jobs) == {'verify', 'verify-continuation', 'npc-orbital', 'scout-rehearsal', 'lab-blockers', 'manual-unit-payments', 'manual-unit-authority'}, jobs\n"),
    ):
        result = manual.exact_replace(result, before, after)
    assert result.endswith('          PYCODE\n')
    return result + manual.AGGREGATE_ARTIFACT_STEPS


def release_transition(value, stage, current):
    result = {}
    for path, count in stage.RELEASE_FILES.items():
        before = value.historical(stage.BASE_SHA, path)
        assert before.count(stage.OLD_VERSION.encode()) == count, ('Historical literal count', path)
        assert current[path] == before.replace(stage.OLD_VERSION.encode(), stage.VERSION.encode()), ('Exact release transition', path)
        result[path] = before
    return result


def validate_argument(operation, argument):
    assert operation in OPERATIONS, 'Unknown projection operation'
    if operation == 'manual_release':
        assert argument in manual.RELEASE_FILES, ('Unsupported manual release path', argument)
    elif operation == 'lab_release':
        assert argument in lab.RELEASE_FILES, ('Unsupported lab release path', argument)
    elif operation == 'lab_transitions':
        assert argument is None
    else:
        assert argument is None or isinstance(argument, str), 'Workflow bytes must be text'


def project(value, operation, argument=None):
    """No Git, Path reads, ambient state or retained acceptance between calls."""
    validate_argument(operation, argument)
    value.verify_seal()
    verify_adoption_delta(value)
    assert sha(value.files[MANIFEST]) == pins.MANIFEST_SHA256, 'Exact energy manifest required'
    workflow = value.historical(energy.BASE_SHA, energy.WORKFLOW_PATH).decode()
    eleven = value.historical(solar.BASE_SHA, energy.WORKFLOW_PATH).decode()
    assert value.files[energy.WORKFLOW_PATH].decode() == solar.expected_workflow(eleven), 'Exact current twelve-job workflow required'
    assert eleven == energy.expected_workflow(workflow), 'Exact eleven-to-eight workflow required'
    release = {}
    for path in RELEASE_FILES:
        items = [item for item in pins.SUPPORT_ROWS if item['path'] == path]
        assert len(items) == 1
        item = items[0]
        assert value.histories[value.candidate][path][0] == '100644'
        assert item['after'] == {'mode': '100644', 'sha256': sha(value.files[path])}, ('Exact current support source', path)
        before = value.historical(energy.BASE_SHA, path)
        assert item['before'] == {'mode': '100644', 'sha256': sha(before)}, ('Exact predecessor support source', path)
        release[path] = before
    for stage in (batch, research, fleet, recycle):
        baseline = value.historical(stage.BASE_SHA, energy.WORKFLOW_PATH).decode()
        assert workflow == stage.expected_workflow(baseline), ('Exact historical workflow', stage.__name__)
        release = release_transition(value, stage, release)
        workflow = baseline
    six = value.historical(manual.SIX_BASE_SHA, energy.WORKFLOW_PATH).decode()
    five = value.historical(manual.BASE_SHA, energy.WORKFLOW_PATH).decode()
    assert workflow == manual_split(six, five), 'Exact seven-to-six workflow required'
    if operation == 'manual_six' and argument is not None:
        assert argument == workflow, 'Explicit seven-job workflow drift'
    assert six == manual.expected_workflow(five)
    if operation == 'manual_workflow' and argument is not None:
        assert argument == six, 'Explicit six-job workflow drift'
    release = release_transition(value, manual, release)
    for path in manual.DIAGNOSTIC_FILES:
        assert value.histories[value.candidate][path][0] == '100644'
        assert value.files[path] == value.historical(manual.DIAGNOSTIC_SHA, path), ('Immutable diagnostic ancestor', path)
    if operation == 'manual_six':
        return six
    if operation == 'manual_workflow':
        return five
    if operation == 'manual_release':
        return release[argument]
    four = value.historical(lab.BASE_SHA, energy.WORKFLOW_PATH).decode()
    assert five == lab.expected_lab_workflow(four), 'Exact five-to-four workflow required'
    if operation == 'lab_workflow' and argument is not None:
        assert argument == five, 'Explicit five-job workflow drift'
    earlier = release_transition(value, lab, release)
    for path, count in lab.CORRECTED_FORMATION_VERSION_FILES.items():
        before = value.historical(lab.CORRECTED_FORMATION_SHA, path)
        assert before.count(lab.OLD_VERSION.encode()) == count
        assert release[path] == before.replace(lab.OLD_VERSION.encode(), lab.VERSION.encode()), ('Corrected formation source drift', path)
    if operation == 'lab_release':
        return earlier[argument]
    if operation == 'lab_transitions':
        return None
    return four


def call(operation, root, argument=None):
    validate_argument(operation, argument)
    return project(prepare(root), operation, argument)
