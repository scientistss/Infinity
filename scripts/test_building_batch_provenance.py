"""Exact multi-planet building-batch adoption on immutable public 6f73735.

Python/Git only. The complete src/public inventory and all fourteen prior seals
remain bound. Independent reviewed file, patch and hunk pins prevent a regenerated
manifest from authorizing different source. All Git writes are disposable objects;
no real index, refs, production source, historical manifest or native evidence is
rewritten. Source identity is not functional, native, CI or release acceptance.
"""
import copy
from functools import lru_cache
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_research_unlock_copy_provenance as research
from test_lab_blockers_provenance import ObjectDatabase

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = '6f73735534ffc1b0e47a01935d8c6e3ff786c989'
MANIFEST = 'tests/fixtures/building-batch-provenance.json'
MANIFEST_SHA256 = 'd05cec8f03492743713b38ffda518c59116f7b74a55cc741f77ceea20bd2b4c1'
RESEARCH_MANIFEST_SHA256 = 'ee3d929da35f41aef0aad587a11ab6acba0726abde44f0de5f753a74c4cb6999'
SCHEMA = 'infinity-ring-protection-building-batch-provenance-v1'
CONTRACT = 'exact-declared-building-batch-source-delta'
CANDIDATE = 'HEAD'
PRODUCTION_PATHS = ('src', 'public')
CHANGED_PATHS = (
    'src/game/building-template-batch-state.ts',
    'src/game/building-template-batch.ts',
    'src/main.ts',
    'src/ui/building-template-batch-panel.ts',
    'src/ui/building-template-batch-present.ts',
    'src/ui/building-template-batch.css',
    'src/ui/space-panel.ts',
)
DOMAIN_CHANGED_PATHS = CHANGED_PATHS[:2]
ADAPTER_PATHS = (
    'scripts/browser-ring-protection.py', 'scripts/check-ui-baseline.mjs',
    'scripts/test_research_unlock_copy_provenance.py',
    'scripts/test_rehearsal_formation_copy_provenance.py',
    'scripts/benchmark-presentation.mjs', 'scripts/test_recycle_preview_display_contract.py',
    'scripts/test_research_unlock_copy_browser.py',
)
UNCHANGED_CHECKER_PATHS = (
    'scripts/test_manual_unit_provenance.py', 'scripts/test_recycle_preview_provenance.py',
    'scripts/test_fleet_row_provenance.py', 'scripts/test_lab_blockers_provenance.py',
    'scripts/test_scout_comparison_provenance.py', 'scripts/test_demolition_domain_provenance.py',
    'tests/presentation-research-unlock-source-contract.test.ts',
)
# Independently reviewed after production freeze on 2026-10-13. The manifest
# digest alone cannot authorize changed source; no command rewrites these pins.
APPROVED_ROWS = [{'path': 'src/game/building-template-batch-state.ts',
  'before': None,
  'after': {'mode': '100644', 'sha256': 'fb2639719675cea91805e9ea915fa5fa19d80e7d537ce58f098b6c2aa431f9f8'},
  'patchSha256': '9a5ed7f934d418d8f6268cebab6aee30e26fb5878e267d791f6339dc73673c26',
  'hunks': [{'header': '@@ -0,0 +1,101 @@',
             'sha256': 'c38de383e9d284619336562826403f2aa6a341cde971354a8add31b82a9bb5b3'}]},
 {'path': 'src/game/building-template-batch.ts',
  'before': None,
  'after': {'mode': '100644', 'sha256': '0de9f5782424cfd2d305035e7e51a89526ba6fdb806efb2d7ee3267dace7160d'},
  'patchSha256': '0323e3f6ec727fb64e02ed4b1568555a0cb0194267b0d571f590e8fd37b102ff',
  'hunks': [{'header': '@@ -0,0 +1,144 @@',
             'sha256': 'be90a5dc8a24b7350cb4652130cd1f1645d535ee8a34ebc75b98a4ad0a07fc9e'}]},
 {'path': 'src/main.ts',
  'before': {'mode': '100644', 'sha256': '871f447bd30fee652d00978caafe0772bf0eba20d11bb62ffdd01db1f203075a'},
  'after': {'mode': '100644', 'sha256': '7ed731417ae50f29f7e8ddbbe48dead05e92aef74159531205b6a4ac5c50b5a5'},
  'patchSha256': 'a27a873d2f8213598a7f65d972cab53e88683fad572eba3dbf9a25d11de614f1',
  'hunks': [{'header': '@@ -3,6 +3,7 @@ import { applyFormationAction } from "./game/formations";',
             'sha256': 'd35b643626ed447e8d595013332437afe6a334b9a23868dfb2c18687e64b5a7b'},
            {'header': '@@ -184,6 +185,7 @@ function render(urgent = true, now = performance.now()): void {',
             'sha256': '5f6b7a188928fa645b2673e8df272fc424402198bc012cc3d57825886b979051'},
            {'header': '@@ -198,6 +200,7 @@ async function handleAction(action: UiAction): Promise<void> {',
             'sha256': 'd3c74a15b97c4dbb510e2ff8963c753524b058a4d7617f801953439d7cbc447f'},
            {'header': '@@ -233,6 +236,30 @@ async function handleAction(action: UiAction): Promise<void> {',
             'sha256': 'a2fd491114207e0c4a68f28e4ac00e6ba795b3f92374e1a32e958a3cda87b908'},
            {'header': '@@ -481,6 +508,7 @@ async function handleAction(action: UiAction): Promise<void> {',
             'sha256': '8f4063772bf75e8d582690d3efdbc52b3ac80e443d3beaabdcf704a63f4fccbc'}]},
 {'path': 'src/ui/building-template-batch-panel.ts',
  'before': None,
  'after': {'mode': '100644', 'sha256': '49bfac6b21dfb7c82f576d3d694d036c5f3ea520771395c029c64aac9300abdf'},
  'patchSha256': '9f997d7e87845768fd857c8d8a7932f9462ca55ed311b7e5ac5a123f4b3e32fb',
  'hunks': [{'header': '@@ -0,0 +1,386 @@',
             'sha256': '66bcf70c0a350f3a7e36dd282f26977717a8934af8a2241a59b048189baf7885'}]},
 {'path': 'src/ui/building-template-batch-present.ts',
  'before': None,
  'after': {'mode': '100644', 'sha256': '144258b64e9116ea6cd33053f6d7fe6ff28c235b4eef02984a97491d5e86d942'},
  'patchSha256': '2a2d84e3e4a36bc282ef41eed65d5e61981b3c2049c16218015a9e8d23d26d32',
  'hunks': [{'header': '@@ -0,0 +1,51 @@',
             'sha256': '929c3535484b913e13244395cf043cbfa4fd36054fccf71a0e04d2f212489d63'}]},
 {'path': 'src/ui/building-template-batch.css',
  'before': None,
  'after': {'mode': '100644', 'sha256': 'fc583720c259d5488affbc5b6092c8fa3e7b67f773591b69e9bf79925b9eca5b'},
  'patchSha256': 'fe2836bf8df2674bafb44fa886de6c0ddc1db98495939217e550acf46b47488f',
  'hunks': [{'header': '@@ -0,0 +1,23 @@',
             'sha256': 'f522d601d4eb820f4b0faad89cce177f546ce2c4e2feab33cb2370e2a9ed508b'}]},
 {'path': 'src/ui/space-panel.ts',
  'before': {'mode': '100644', 'sha256': '970c1f8a9102ef14f9680b3e34d22354abb4bb71353e4778c1a5fce6c777f65e'},
  'after': {'mode': '100644', 'sha256': '60b09f155cafc8eedd5fcc19fecb6a4e2d377d9c363490800fde32ec9c7e8658'},
  'patchSha256': '0c47e41c8c3164ec4301e2d45979ac7b9d48f039b2206caf0aa966a81565cdf1',
  'hunks': [{'header': '@@ -15,6 +15,8 @@ import { researchTemplatesPanelHtml, installResearchTemplatesPanel '
                       '} from "./res',
             'sha256': 'eab760c764f18613a275adf3b4e51bd3c6ae1fb846ad88e65e2b2262a5bd3fb2'},
            {'header': '@@ -30,7 +32,7 @@ import { fillTransportCargo } from "./transport-load-model";',
             'sha256': '0903920e6f46acca22be58b46dd67049b779adae5696da589f466b7bf380bcb5'},
            {'header': '@@ -326,10 +328,11 @@ export function '
                       'mountView(root:HTMLElement,onAction:(a:UiAction)=>void) {',
             'sha256': '42f4c47fe601746b8e81a38100d23ee4d26dbfaadd43feb29a7e0ee9b706e91b'},
            {'header': '@@ -448,13 +451,18 @@ export function '
                       'mountView(root:HTMLElement,onAction:(a:UiAction)=>void) {',
             'sha256': 'bdd0155394b7fb0af4765079d38d454765c2bae0be4de0463301e45cfd890121'}]}]
RING_HOOK = "    if candidate != '6f73735534ffc1b0e47a01935d8c6e3ff786c989' and git('ls-tree', candidate, '--', 'tests/fixtures/building-batch-provenance.json'):\n        from test_building_batch_provenance import building_batch_provenance\n        return building_batch_provenance(repository, candidate, git, check)\n"
FORMATION_ANCHOR = "        if result['contract'] == 'exact-declared-research-unlock-copy-source-delta':\n"
FORMATION_ADAPTER = (
    "        if result['contract'] == 'exact-declared-building-batch-source-delta':\n"
    "            from test_building_batch_provenance import verify_candidate as verify_batch_candidate, REFERENCE as batch_base\n"
    "            self.assertEqual(result, verify_batch_candidate(candidate))\n"
    "            self.assertEqual(result['previousAdoptionSourceSha'], batch_base)\n"
    "            result = result['previousProvenance']\n"
    "            self.assertEqual(result['contract'], 'exact-declared-research-unlock-copy-source-delta')\n"
    "            self.assertEqual(result['candidateSourceSha'], batch_base)\n"
)


def digest(raw): return hashlib.sha256(raw).hexdigest()


def git_read(*args):
    return subprocess.check_output(['git', '--no-replace-objects', '-C', str(ROOT), *args], stderr=subprocess.PIPE)


def module():
    spec = importlib.util.spec_from_file_location('building_batch_ring_contract', ROOT/'scripts/browser-ring-protection.py')
    ring = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ring)
    return ring


changed, entry, row, manifest_bytes = research.changed, research.entry, research.row, research.manifest_bytes
ordinary_bytes = research.ordinary_bytes
source_inventory, assert_worktree_inventory = research.source_inventory, research.assert_worktree_inventory
exact_replace = research.exact_replace


def previous_manifests(ring):
    return [*research.previous_manifests(ring), (research.MANIFEST, RESEARCH_MANIFEST_SHA256)]


def approved_rows():
    assert [item['path'] for item in APPROVED_ROWS] == list(CHANGED_PATHS), 'Building batch source has not been independently frozen'
    return copy.deepcopy(APPROVED_ROWS)


def expected_inventory(git):
    inventory = source_inventory(git, REFERENCE)
    for item in approved_rows(): inventory[item['path']] = item['after']
    return dict(sorted(inventory.items()))


def manifest_fields(ring, git, rows, inventory):
    prior = json.loads(git('show', REFERENCE+':'+research.MANIFEST))
    return {
        'schema': SCHEMA, 'historicalBaselineSha': ring.BASELINE,
        'previousAdoptionSourceSha': REFERENCE,
        'previousManifests': [{'path': path, 'sha256': sha} for path, sha in previous_manifests(ring)],
        'referenceStatus': 'Exact reviewed building-batch source adoption on recursively verified public 6f73735 research-copy source. Every earlier source contract remains independently verifiable.',
        'scope': 'Every src/public file and mode, complete production inventory, exact before/after bytes, deterministic patch and every hunk are bound. All fourteen prior seals, existing UI source outside two declared wiring paths, original cumulative UI rows and all public art remain unchanged.',
        'approvedDelta': 'Two new bounded multi-planet building-template domain modules, three new scoped batch UI files and exact main/space-panel wiring. Existing single-planet building, wallet, paid queue, scheduler, save schema, research, combat, transport, ring, original view/styles and public assets remain byte-identical to public 6f73735.',
        'productionPaths': list(PRODUCTION_PATHS), 'domainPaths': list(ring.DOMAIN_PATHS),
        'originalRingCriticalPaths': list(ring.RING_CRITICAL_PATHS),
        'exactDomainDeltaPaths': list(DOMAIN_CHANGED_PATHS), 'exactRingCriticalDeltaPaths': [],
        'productionInventory': inventory, 'originalUiBaseline': prior['originalUiBaseline'],
        'changedPaths': rows,
    }


def make_manifest(ring, git, candidate):
    assert changed(git, REFERENCE, candidate, PRODUCTION_PATHS) == list(CHANGED_PATHS), 'Only the seven exact building-batch production paths may change'
    rows = [row(ring, git, REFERENCE, candidate, path) for path in CHANGED_PATHS]
    assert rows == approved_rows(), 'Building-batch file bytes, modes, complete patches or hunks differ from independent reviewed pins'
    assert changed(git, REFERENCE, candidate, ring.DOMAIN_PATHS) == list(DOMAIN_CHANGED_PATHS), 'Only the two new batch domain modules may change'
    assert changed(git, REFERENCE, candidate, ring.RING_CRITICAL_PATHS) == [], 'All ring-critical source remains fixed at public 6f73735'
    assert changed(git, REFERENCE, candidate, ('public',)) == [], 'All original public art remains unchanged'
    baseline = json.loads(git('show', REFERENCE+':'+research.MANIFEST))['originalUiBaseline']
    assert baseline['changedPaths'] == [row(ring, git, research.fleet.recycle.manual.ORIGINAL_UI_REFERENCE, candidate, path)
                                        for path in research.fleet.recycle.manual.ORIGINAL_UI_PATHS], 'Original cumulative UI rows remain exactly at public 6f73735'
    inventory = source_inventory(git, candidate)
    assert inventory == expected_inventory(git), 'Every undeclared production path and mode must remain fixed at public 6f73735'
    return manifest_fields(ring, git, rows, inventory)


@lru_cache(maxsize=1)
def frozen_manifest_bytes():
    """Only immutable public Git objects and independent reviewed pins are used."""
    return manifest_bytes(manifest_fields(module(), git_read, approved_rows(), expected_inventory(git_read)))


def read_manifest(repository):
    raw = ordinary_bytes(repository/MANIFEST)
    assert re.fullmatch('[0-9a-f]{64}', MANIFEST_SHA256) and digest(raw) == MANIFEST_SHA256, 'Building-batch manifest is not the exact frozen seal'
    assert raw == frozen_manifest_bytes(), 'Manifest repinning cannot change independently fixed source, patches, hunks or metadata'
    def pairs(items):
        result = {}
        for key, value in items:
            assert key not in result, 'Duplicate building-batch manifest key'
            result[key] = value
        return result
    value = json.loads(raw, object_pairs_hook=pairs)
    assert value['schema'] == SCHEMA and value['previousAdoptionSourceSha'] == REFERENCE
    assert value['previousManifests'] == [{'path': path, 'sha256': sha} for path, sha in previous_manifests(module())]
    return raw, value


def building_batch_provenance(repository, candidate, git, check):
    ring = module()
    check('Building batch integrates exact public 6f73735 ancestry', git('merge-base', REFERENCE, candidate).decode().strip() == REFERENCE)
    for path, expected in previous_manifests(ring):
        check('Building batch preserves every local and committed earlier seal: '+path,
              digest(ordinary_bytes(repository/path)) == expected
              and entry(git, candidate, path) == entry(git, REFERENCE, path) == {'mode': '100644', 'sha256': expected})
    raw, value = read_manifest(repository)
    check('Building-batch manifest is the exact committed ordinary-file seal',
          entry(git, candidate, MANIFEST) == {'mode': '100644', 'sha256': MANIFEST_SHA256}
          and raw == git('show', candidate+':'+MANIFEST))
    check('Building batch binds every inventory entry, field, source byte, mode, patch and hunk', value == make_manifest(ring, git, candidate))
    # Reject altered current bytes/seals before evaluating the unchanged historical
    # chain. Positive acceptance still runs every prior assertion exactly once.
    # Call the prior historical layer directly: no verify_candidate delegation
    # and no recursive re-entry into this successor from its immutable baseline.
    prior = research.research_unlock_copy_provenance(repository, REFERENCE, git, check)
    check('Building batch recursively preserves the public research-copy contract', prior['contract'] == research.CONTRACT and prior['candidateSourceSha'] == REFERENCE)
    check('Building batch does not claim historical domain byte identity', prior['historicalDomainByteIdentity'] is False)
    return {'contract': CONTRACT, 'historicalBaselineSha': ring.BASELINE, 'historicalDomainByteIdentity': False,
            'previousAdoptionSourceSha': REFERENCE, 'candidateSourceSha': candidate,
            'historicalChangedPaths': changed(git, ring.BASELINE, candidate, ring.DOMAIN_PATHS),
            'previousProvenance': prior, 'manifestPath': MANIFEST, 'manifestSha256': digest(raw), 'manifest': value,
            'verificationScope': 'Exact cumulative building-batch source adoption only; not native or CI acceptance. All earlier native gates and complete release acceptance remain required.'}


def historical_bytes(path): return git_read('show', REFERENCE+':'+path)


def ring_transition(before):
    before = exact_replace(before, research.RING_HOOK.encode(), (RING_HOOK+research.RING_HOOK).encode())
    # Only the exact approved third retirement call is added to the historical
    # paired parser. No captures, guards, alternative prefixes or native actions
    # are changed; projecting this complete transition restores every old byte.
    old = r"""        rf'\({identifier}\.retireNpcRehearsal\(\),{identifier}\.retireManualUnits\(\)\)),)?'
"""
    new = r"""        rf'\({identifier}\.retireNpcRehearsal\(\),{identifier}\.retireManualUnits\(\)\)|'
        rf'\({identifier}\.retireNpcRehearsal\(\),{identifier}\.retireManualUnits\(\),{identifier}\.retireBuildingTemplateBatch\(\)\)),)?'
"""
    before = exact_replace(before, old.encode(), new.encode())
    old = """        if paired is not None and paired.group(1) != paired.group(2):
            continue
        valid.append(match)
"""
    new = r"""        if paired is not None and paired.group(1) != paired.group(2):
            continue
        # The new triple is exact and all three no-argument calls share one view.
        # These separate validation captures cannot shift native match groups.
        triple = re.search(
            rf'&&\(({identifier})\.retireNpcRehearsal\(\),({identifier})\.retireManualUnits\(\),({identifier})\.retireBuildingTemplateBatch\(\)\),',
            match.group(0))
        if triple is not None and len(set(triple.groups())) != 1:
            continue
        valid.append(match)
"""
    return exact_replace(before, old.encode(), new.encode())


def ui_transition(before, manifest_sha256):
    expected = before.decode()
    for old, new, count in (
        ('RESEARCH_UNLOCK_COPY_MANIFEST_SHA256', 'BUILDING_BATCH_MANIFEST_SHA256', 4),
        (RESEARCH_MANIFEST_SHA256, manifest_sha256, 1),
        (research.MANIFEST, MANIFEST, 1),
        ('scripts/test_research_unlock_copy_provenance.py', 'scripts/test_building_batch_provenance.py', 1),
        (research.CONTRACT, CONTRACT, 1), (research.REFERENCE, REFERENCE, 1),
        ('complete original-to-research-unlock-copy cumulative source seal', 'complete original-to-building-batch cumulative source seal', 1),
        ('thirteen earlier seals', 'fourteen earlier seals', 1),
        ('unchanged public-493 cumulative UI deltas with exact research unlock copy adoption', 'unchanged public-6f73735 cumulative UI deltas with exact building batch adoption', 1),
        ('研究解锁文案 UI', '多星球建造批次 UI', 4),
    ):
        assert expected.count(old) == count, ('Exact building-batch UI checker transition cardinality', old)
        expected = expected.replace(old, new)
    return expected.encode()


def formation_transition(before):
    return exact_replace(before, FORMATION_ANCHOR.encode(), (FORMATION_ADAPTER+FORMATION_ANCHOR).encode())


def research_transition(before):
    old = "    assert ordinary_bytes(repository/path) == transitions[path](before), ('Unapproved research compatibility adapter drift', path)\n"
    new = ("    current = ordinary_bytes(repository/path)\n"
           "    if current != transitions[path](before):\n"
           "        from test_building_batch_provenance import previous_bytes as batch_previous_bytes\n"
           "        current = batch_previous_bytes(path, repository)\n"
           "    assert current == transitions[path](before), ('Unapproved research compatibility adapter drift', path)\n")
    before = exact_replace(before, old.encode(), new.encode())
    old = "    assert candidate != REFERENCE, 'Research unlock candidate must be committed separately from its public baseline'\n"
    new = ("    if git_read('ls-tree', candidate, '--', 'tests/fixtures/building-batch-provenance.json'):\n"
           "        from test_building_batch_provenance import verify_candidate as verify_batch_candidate\n"
           "        result = verify_batch_candidate(candidate)\n"
           "        assert result['contract'] == 'exact-declared-building-batch-source-delta'\n"
           "        return result['previousProvenance']\n"+old)
    before = exact_replace(before, old.encode(), new.encode())
    old = "def verify_ui_baseline():\n    db = ObjectDatabase()\n"
    new = ("def verify_ui_baseline():\n"
           "    if (ROOT/'tests/fixtures/building-batch-provenance.json').exists():\n"
           "        from test_building_batch_provenance import verify_previous_ui_baseline\n"
           "        return verify_previous_ui_baseline()\n"
           "    db = ObjectDatabase()\n")
    return exact_replace(before, old.encode(), new.encode())


BENCHMARK_PROOF = """const buildingBatchSourceProof = (() => {
  const manifestPath = "tests/fixtures/building-batch-provenance.json";
  const raw = readFileSync(resolve(afterRoot, manifestPath));
  const manifestSha256 = sha256(raw);
  assert.equal(manifestSha256, "__MANIFEST_SHA__", "exact independently frozen building-batch source seal");
  const manifest = JSON.parse(raw);
  const sourceAudit = JSON.parse(execFileSync("python3",
    ["-B", "scripts/test_building_batch_provenance.py", "--verify-ui-baseline"], { cwd: afterRoot, encoding: "utf8" }));
  const paths = ["src/game/building-template-batch-state.ts", "src/game/building-template-batch.ts", "src/main.ts",
    "src/ui/building-template-batch-panel.ts", "src/ui/building-template-batch-present.ts", "src/ui/building-template-batch.css", "src/ui/space-panel.ts"];
  assert.equal(sourceAudit.contract, "exact-declared-building-batch-source-delta", "current complete building-batch source contract");
  assert.equal(sourceAudit.sourceBaseline, "6f73735534ffc1b0e47a01935d8c6e3ff786c989", "exact public pre-batch source");
  assert.equal(sourceAudit.manifestSha256, manifestSha256, "current independently verified batch seal");
  assert.deepEqual(sourceAudit.approvedSourceDeltaPaths, paths, "only the seven reviewed batch source paths");
  assert.ok(Number.isInteger(sourceAudit.checks) && sourceAudit.checks > 174, "complete current and all historical source checks must run");
  assert.equal(manifest.schema, "infinity-ring-protection-building-batch-provenance-v1", "exact current batch schema");
  assert.equal(manifest.previousAdoptionSourceSha, sourceAudit.sourceBaseline, "current batch adoption baseline");
  assert.equal(Object.keys(manifest.productionInventory).length, 215, "complete current batch production inventory");
  assert.equal(manifest.previousManifests.length, 14, "all fourteen earlier immutable source seals retained");
  assert.deepEqual(manifest.changedPaths.map(row => row.path), paths, "complete exact current batch delta");
  assert.deepEqual(manifest.previousManifests[13], { path: "tests/fixtures/research-unlock-copy-provenance.json",
    sha256: "ee3d929da35f41aef0aad587a11ab6acba0726abde44f0de5f753a74c4cb6999" }, "separately preserved historical research-copy seal");
  assert.deepEqual(sourceAudit.originalUiBaseline, manifest.originalUiBaseline, "unchanged original cumulative UI and art bindings");
  return { manifestPath, manifestSha256, contract: sourceAudit.contract, sourceBaseline: sourceAudit.sourceBaseline,
    productionEntries: 215, previousSeals: 14, approvedSourceDeltaPaths: paths, checks: sourceAudit.checks,
    scope: "Exact complete current batch source identity. The following 210-entry research proof is explicitly historical; native behavior and measured performance are separate evidence." };
})();
"""


def benchmark_transition(before, manifest_sha256):
    anchor = b'// This adapter is intentionally specific to the old no-lab-work workload.\n'
    result = exact_replace(before, anchor, BENCHMARK_PROOF.replace('__MANIFEST_SHA__', manifest_sha256).encode()+anchor)
    old = b'  sources: { beforeRoot, afterRoot, before: sourceHashes(beforeRoot), after: sourceHashes(afterRoot) },\n'
    new = old.replace(b'after: sourceHashes(afterRoot)', b'after: sourceHashes(afterRoot), currentBuildingBatch: buildingBatchSourceProof')
    return exact_replace(result, old, new)


def display_transition(before):
    old = b"def research_unlock_benchmark_before(current):\n"
    new = old + ("    if digest(current) != RESEARCH_BENCHMARK_AFTER_SHA:\n"
                 "        from test_building_batch_provenance import previous_benchmark_bytes\n"
                 "        current = previous_benchmark_bytes(current.encode('utf-8')).decode('utf-8')\n").encode()
    before = exact_replace(before, old, new)
    old = b"    def source(self):\n        return (ROOT/BENCHMARK).read_bytes().decode('utf-8')\n"
    new = ("    def source(self):\n"
           "        from test_building_batch_provenance import previous_benchmark_bytes\n"
           "        return previous_benchmark_bytes((ROOT/BENCHMARK).read_bytes()).decode('utf-8')\n").encode()
    before = exact_replace(before, old, new)
    old = b"def assert_exact_runner_transition(current):\n"
    new = old + ("    from building_batch_display_contract import building_batch_render_contract_before\n"
                 "    current = building_batch_render_contract_before(current)\n").encode()
    return exact_replace(before, old, new)


def browser_test_transition(before):
    old = b"    assert hashlib.sha256(current).hexdigest() == DISPLAY_CONTRACT_AFTER_SHA, 'Complete approved display test required'\n"
    new = ("    if hashlib.sha256(current).hexdigest() != DISPLAY_CONTRACT_AFTER_SHA:\n"
           "        from test_building_batch_provenance import previous_display_contract_bytes\n"
           "        current = previous_display_contract_bytes(current)\n").encode() + old
    before = exact_replace(before, old, new)
    old = b"        source = (ROOT / 'scripts/browser-render-scheduling.py').read_bytes()\n"
    new = old + ("        from building_batch_display_contract import building_batch_render_contract_before\n"
                 "        source = building_batch_render_contract_before(source.decode('utf-8')).encode('utf-8')\n").encode()
    return exact_replace(before, old, new)


def previous_benchmark_bytes(current, repository=None):
    repository = ROOT if repository is None else repository
    read_manifest(repository)
    before = historical_bytes('scripts/benchmark-presentation.mjs')
    assert current == benchmark_transition(before, MANIFEST_SHA256), 'Exact complete building-batch benchmark transition required'
    return before


def previous_display_contract_bytes(current, repository=None):
    repository = ROOT if repository is None else repository
    read_manifest(repository)
    before = historical_bytes('scripts/test_recycle_preview_display_contract.py')
    assert current == display_transition(before), 'Exact complete building-batch display-contract transition required'
    return before


def previous_bytes(path, repository=None):
    repository = ROOT if repository is None else repository
    assert path in ADAPTER_PATHS, ('Unsupported building-batch compatibility projection', path)
    read_manifest(repository)
    before = historical_bytes(path)
    transitions = {ADAPTER_PATHS[0]: ring_transition, ADAPTER_PATHS[1]: lambda raw: ui_transition(raw, MANIFEST_SHA256),
                   ADAPTER_PATHS[2]: research_transition, ADAPTER_PATHS[3]: formation_transition,
                   ADAPTER_PATHS[4]: lambda raw: benchmark_transition(raw, MANIFEST_SHA256),
                   ADAPTER_PATHS[5]: display_transition, ADAPTER_PATHS[6]: browser_test_transition}
    assert ordinary_bytes(repository/path) == transitions[path](before), ('Unapproved building-batch compatibility adapter drift', path)
    return before


def verify_unchanged_checker_bytes(repository):
    for path in UNCHANGED_CHECKER_PATHS:
        assert ordinary_bytes(repository/path) == historical_bytes(path), ('Prior checker must remain byte-identical to public 6f73735', path)


def capture_worktree(db):
    assert_worktree_inventory(ROOT, expected_inventory(db.git))
    for path, expected_hash in previous_manifests(module()):
        assert digest(ordinary_bytes(ROOT/path)) == expected_hash
        assert ordinary_bytes(ROOT/path) == db.git('show', REFERENCE+':'+path)
    candidate = db.make(REFERENCE, {path: ('100644', ordinary_bytes(ROOT/path)) for path in CHANGED_PATHS})
    return candidate, manifest_bytes(make_manifest(module(), db.git, candidate))


def build_worktree_manifest(destination):
    """May reproduce the reviewed seal only; never updates any independent pins."""
    db = ObjectDatabase()
    try:
        _, raw = capture_worktree(db)
        assert raw == frozen_manifest_bytes()
        Path(destination).write_bytes(raw)
        print(json.dumps({'path': str(destination), 'sha256': digest(raw), 'approvedSourceDeltaPaths': list(CHANGED_PATHS)}))
    finally: db.close()


def verify_ui_baseline():
    db = ObjectDatabase()
    try:
        candidate, expected = capture_worktree(db)
        raw, _ = read_manifest(ROOT)
        assert raw == expected, 'Current production does not match frozen building-batch seal'
        for path in ADAPTER_PATHS: previous_bytes(path)
        verify_unchanged_checker_bytes(ROOT)
        candidate = db.make(candidate, {MANIFEST: ('100644', raw)})
        checks = []
        def check(name, passed, detail=None):
            assert passed, name
            checks.append(name)
        result = building_batch_provenance(ROOT, candidate, db.git, check)
        assert len(checks) > 174, 'Complete prior source-provenance chain required'
        return {'contract': result['contract'], 'sourceScope': 'Exact current src/public inventory, bytes and modes; disposable objects only',
                'sourceBaseline': REFERENCE, 'manifestSha256': digest(raw), 'checks': len(checks),
                'originalUiBaseline': result['manifest']['originalUiBaseline'], 'approvedSourceDeltaPaths': list(CHANGED_PATHS)}
    finally: db.close()


def verify_previous_ui_baseline():
    """Project the historical research contract only after full current verification.

    Existing benchmark callers retain all their research-specific assertions.
    The extra currentAdoption record prevents mislabelling the old source scope.
    """
    current = verify_ui_baseline()
    prior_raw, prior = research.read_manifest(ROOT)
    return {'contract': research.CONTRACT,
            'sourceScope': 'Historical research-copy projection after exact current building-batch inventory, bytes, modes, adapters and all earlier seals were verified',
            'sourceBaseline': research.REFERENCE, 'manifestSha256': digest(prior_raw), 'checks': current['checks'],
            'originalUiBaseline': prior['originalUiBaseline'], 'approvedSourceDeltaPaths': list(research.CHANGED_PATHS),
            'currentAdoption': current}


def verify_candidate(candidate):
    candidate = git_read('rev-parse', candidate+'^{commit}').decode().strip()
    assert candidate != REFERENCE, 'Building-batch candidate must be committed separately from its public baseline'
    for path in (*ADAPTER_PATHS, *UNCHANGED_CHECKER_PATHS, 'scripts/test_building_batch_provenance.py', MANIFEST):
        raw = ordinary_bytes(ROOT/path)
        assert raw == git_read('show', candidate+':'+path) and entry(git_read, candidate, path) == {'mode': '100644', 'sha256': digest(raw)}, ('Executed seal bytes or mode differ from committed candidate', path)
    for path in ADAPTER_PATHS: previous_bytes(path)
    verify_unchanged_checker_bytes(ROOT)
    assert_worktree_inventory(ROOT, source_inventory(git_read, candidate))
    checks = []
    def check(name, passed, detail=None):
        assert passed, name
        checks.append(name)
    result = building_batch_provenance(ROOT, candidate, git_read, check)
    assert len(checks) > 174, 'Complete prior source-provenance chain required'
    return result


class BuildingBatchSyntheticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.db = ObjectDatabase()
    @classmethod
    def tearDownClass(cls): cls.db.close()

    def setUp(self):
        self.ring, self.git, self.make = module(), self.db.git, self.db.make
        self.view = self.db.tmp/'building-batch-view'
        for path, _ in previous_manifests(self.ring):
            local = self.view/path; local.parent.mkdir(parents=True, exist_ok=True)
            if local.is_symlink(): local.unlink()
            local.write_bytes(self.git('show', REFERENCE+':'+path)); local.chmod(0o644)
        self.sources = {path: ordinary_bytes(ROOT/path) for path in CHANGED_PATHS}
        self.provisional = self.make(REFERENCE, {path: ('100644', raw) for path, raw in self.sources.items()})
        self.manifest = make_manifest(self.ring, self.git, self.provisional)
        self.raw = manifest_bytes(self.manifest)
        self.assertEqual(digest(self.raw), MANIFEST_SHA256)
        local = self.view/MANIFEST
        if local.is_symlink(): local.unlink()
        local.write_bytes(self.raw); local.chmod(0o644)
        self.candidate = self.make(self.provisional, {MANIFEST: ('100644', self.raw)})

    def evaluate(self, candidate=None):
        def check(name, passed, detail=None): assert passed, name
        return self.ring.synchronized_domain_provenance(self.view, candidate or self.candidate, self.git, check)

    def reject(self, candidate=None):
        with self.assertRaises((AssertionError, FileNotFoundError, KeyError, TypeError, subprocess.CalledProcessError)):
            self.evaluate(candidate)

    def reject_repinned(self, value):
        raw = manifest_bytes(value); (self.view/MANIFEST).write_bytes(raw)
        candidate = self.make(self.candidate, {MANIFEST: ('100644', raw)})
        with patch(__name__+'.MANIFEST_SHA256', digest(raw)), patch('test_building_batch_provenance.MANIFEST_SHA256', digest(raw)):
            self.reject(candidate)
        (self.view/MANIFEST).write_bytes(self.raw)

    def test_exact_reviewed_delta_recursively_retains_all_fourteen_seals(self):
        result = self.evaluate()
        self.assertEqual(result['contract'], CONTRACT)
        self.assertEqual(result['previousProvenance']['contract'], research.CONTRACT)
        self.assertEqual(result['previousProvenance']['candidateSourceSha'], REFERENCE)
        self.assertEqual(len(result['manifest']['previousManifests']), 14)
        self.assertIs(result['historicalDomainByteIdentity'], False)
        self.assertIn('not native or CI acceptance', result['verificationScope'])
        self.assertEqual(result['manifest']['originalUiBaseline'], result['previousProvenance']['manifest']['originalUiBaseline'])
        self.assertEqual(len(result['manifest']['productionInventory']), len(source_inventory(self.git, REFERENCE)) + 5)

    def test_every_approved_source_rejects_bytes_modes_symlink_delete_and_reversion(self):
        for path, raw in self.sources.items():
            values = [('100644', raw+b' '), ('100755', raw), ('120000', b'other.ts'), None]
            if entry(self.git, REFERENCE, path): values.append(('100644', self.git('show', REFERENCE+':'+path)))
            for value in values:
                with self.subTest(path=path, value=value): self.reject(self.make(self.candidate, {path: value}))

    def test_full_source_scope_rejects_unrelated_additions_and_changes(self):
        for path in ('src/unknown.ts', 'src/ui/unknown.ts', 'src/game/unknown.ts', 'src/core/unknown.ts',
                     'src/data/unknown.ts', 'src/automation/unknown.ts', 'public/unknown.svg', 'src/.hidden.ts'):
            with self.subTest(path=path): self.reject(self.make(self.candidate, {path: ('100644', b'extra')}))
        for path in ('src/style.css', 'src/space.css', 'src/ui/view.ts', 'src/ui/present.ts', 'src/game/save.ts',
                     'src/game/building-templates.ts', 'src/game/orders.ts', 'src/core/offline.ts', 'src/data/units.ts',
                     'src/ui/recycle-preview-panel.ts', 'src/ui/ring-model.ts', 'src/game/arcade.ts',
                     'src/automation/engine.ts', 'src/data/ring-art.json', 'public/icons/ring_machine.webp', 'public/favicon-32.png'):
            raw = self.git('show', REFERENCE+':'+path)
            for value in [('100644', raw+b' '), ('100755', raw), ('120000', b'other.ts'), None]:
                with self.subTest(path=path, value=value): self.reject(self.make(self.candidate, {path: value}))

    def test_manifest_regeneration_cannot_admit_any_changed_implementation(self):
        for path, raw in self.sources.items():
            with self.subTest(path=path), self.assertRaises(AssertionError):
                make_manifest(self.ring, self.git, self.make(self.candidate, {path: ('100644', raw+b' ')}))
        for path in ('src/game/save.ts', 'public/favicon-32.png'):
            raw = self.git('show', REFERENCE+':'+path)
            with self.subTest(path=path), self.assertRaises(AssertionError):
                make_manifest(self.ring, self.git, self.make(self.candidate, {path: ('100644', raw+b' ')}))

    def test_all_manifest_fields_fail_even_when_repinned(self):
        for key in self.manifest:
            value = copy.deepcopy(self.manifest); del value[key]
            with self.subTest(key=key): self.reject_repinned(value)
        mutations = [lambda m: m.update(unknown=True), lambda m: m.update(schema='unknown'),
            lambda m: m.update(previousAdoptionSourceSha=research.REFERENCE),
            lambda m: m['productionPaths'].append('scripts'), lambda m: m['exactDomainDeltaPaths'].append('src/game/save.ts'),
            lambda m: m['previousManifests'].pop(), lambda m: m['previousManifests'].reverse(),
            lambda m: m['productionInventory'].pop('src/main.ts'),
            lambda m: m['productionInventory']['src/main.ts'].update(sha256='0'*64),
            lambda m: m['productionInventory']['src/main.ts'].update(mode='100755'),
            lambda m: m['productionInventory'].update({'public/extra.svg': {'mode': '100644', 'sha256': '0'*64}}),
            lambda m: m['originalUiBaseline']['changedPaths'][0]['before'].update(sha256='0'*64),
            lambda m: m['changedPaths'].reverse(), lambda m: m['changedPaths'].append(copy.deepcopy(m['changedPaths'][0]))]
        for mutate in mutations:
            value = copy.deepcopy(self.manifest); mutate(value); self.reject_repinned(value)

    def test_every_approved_row_and_hunk_is_fixed_even_when_repinned(self):
        for index, approved in enumerate(self.manifest['changedPaths']):
            for field in ('path', 'before', 'after', 'patchSha256', 'hunks'):
                value = copy.deepcopy(self.manifest); value['changedPaths'][index][field] = 'altered' if approved[field] is None else None
                with self.subTest(path=approved['path'], field=field): self.reject_repinned(value)
            for field in ('mode', 'sha256'):
                value = copy.deepcopy(self.manifest); value['changedPaths'][index]['after'][field] = 'bad'
                self.reject_repinned(value)
            for hunk_index in range(len(approved['hunks'])):
                for field in ('header', 'sha256'):
                    value = copy.deepcopy(self.manifest); value['changedPaths'][index]['hunks'][hunk_index][field] = 'bad'
                    self.reject_repinned(value)
            value = copy.deepcopy(self.manifest); value['changedPaths'][index]['hunks'].pop(); self.reject_repinned(value)

    def test_all_fourteen_older_seals_reject_local_and_committed_drift(self):
        for path, _ in previous_manifests(self.ring):
            raw = self.git('show', REFERENCE+':'+path)
            for value in [('100644', raw+b' '), ('100755', raw), ('120000', b'other.json'), None]:
                with self.subTest(path=path, value=value): self.reject(self.make(self.candidate, {path: value}))
            local = self.view/path
            local.write_bytes(raw+b' '); self.reject(); local.write_bytes(raw)
            local.chmod(0o755); self.reject(); local.chmod(0o644)
            local.unlink(); self.reject()
            target = self.db.tmp/'prior-seal-target'; target.write_bytes(raw)
            local.symlink_to(target); self.reject(); local.unlink(); local.write_bytes(raw)

    def test_new_manifest_local_and_committed_bytes_modes_and_symlink_fail(self):
        local = self.view/MANIFEST
        local.write_bytes(self.raw+b' '); self.reject(); local.write_bytes(self.raw)
        local.chmod(0o755); self.reject(); local.chmod(0o644)
        for value in [('100755', self.raw), ('120000', b'other.json'), None]: self.reject(self.make(self.candidate, {MANIFEST: value}))
        local.unlink(); self.reject()
        target = self.db.tmp/'building-batch-manifest-target'; target.write_bytes(self.raw)
        local.symlink_to(target); self.reject(); local.unlink(); local.write_bytes(self.raw)

    def test_unrelated_ancestry_cannot_adopt_identical_source(self):
        tree = self.git('rev-parse', self.candidate+'^{tree}').decode().strip()
        self.reject(self.git('commit-tree', tree, input=b'Unrelated source\n').decode().strip())

    def test_old_public_source_keeps_its_independent_research_contract(self):
        result = self.evaluate(REFERENCE)
        self.assertEqual(result['contract'], research.CONTRACT)
        self.assertEqual(result['manifestSha256'], RESEARCH_MANIFEST_SHA256)
        self.assertEqual(source_inventory(self.git, REFERENCE), source_inventory(self.git, '64176f94a43564be73c64ce21968d36e2ae329a3'))

    def test_exact_checker_and_prior_contract_transitions(self):
        verify_unchanged_checker_bytes(ROOT)
        for path in ADAPTER_PATHS: self.assertEqual(previous_bytes(path), historical_bytes(path))
        self.assertEqual(research.previous_bytes(ADAPTER_PATHS[0]), research.historical_bytes(ADAPTER_PATHS[0]))
        self.assertEqual(research.previous_bytes(ADAPTER_PATHS[1]), research.historical_bytes(ADAPTER_PATHS[1]))
        self.assertEqual(research.previous_bytes(ADAPTER_PATHS[3]), research.historical_bytes(ADAPTER_PATHS[3]))

    def test_projection_refuses_changed_manifest_or_any_adapter_byte(self):
        transitions = (ring_transition, lambda raw: ui_transition(raw, MANIFEST_SHA256), research_transition, formation_transition,
                       lambda raw: benchmark_transition(raw, MANIFEST_SHA256), display_transition, browser_test_transition)
        for path, transition in zip(ADAPTER_PATHS, transitions):
            local = self.view/path; local.parent.mkdir(parents=True, exist_ok=True)
            expected = transition(historical_bytes(path)); local.write_bytes(expected); local.chmod(0o644)
            self.assertEqual(previous_bytes(path, self.view), historical_bytes(path))
            for bad in (expected+b'\n', expected.replace(b'\n', b'\r\n'), b'unapproved'):
                local.write_bytes(bad)
                with self.assertRaises(AssertionError): previous_bytes(path, self.view)
            local.write_bytes(expected); local.chmod(0o755)
            with self.assertRaises(AssertionError): previous_bytes(path, self.view)
            local.chmod(0o644); local.unlink(); local.symlink_to(ROOT/path)
            with self.assertRaises(AssertionError): previous_bytes(path, self.view)
            local.unlink(); local.write_bytes(expected)
        (self.view/MANIFEST).write_bytes(self.raw+b' ')
        for path in ADAPTER_PATHS:
            with self.assertRaises(AssertionError): previous_bytes(path, self.view)
        (self.view/MANIFEST).write_bytes(self.raw)

    def test_prior_checkers_cannot_drift_behind_successor_projection(self):
        for path in UNCHANGED_CHECKER_PATHS:
            local = self.view/path; local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(historical_bytes(path)); local.chmod(0o644)
        for path in UNCHANGED_CHECKER_PATHS:
            local = self.view/path; expected = historical_bytes(path)
            verify_unchanged_checker_bytes(self.view)
            local.write_bytes(expected+b'\n')
            with self.assertRaises(AssertionError): verify_unchanged_checker_bytes(self.view)
            local.write_bytes(expected); local.chmod(0o755)
            with self.assertRaises(AssertionError): verify_unchanged_checker_bytes(self.view)
            local.chmod(0o644)

    def test_complete_local_inventory_rejects_hidden_extra_symlink_mode_missing_and_stale_files(self):
        root = self.db.tmp/'inventory-view'
        for directory in PRODUCTION_PATHS: (root/directory).mkdir(parents=True, exist_ok=True)
        path = root/'src/test.ts'; path.write_bytes(b'exact'); path.chmod(0o644)
        expected = {'src/test.ts': {'mode': '100644', 'sha256': digest(b'exact')}}
        assert_worktree_inventory(root, expected)
        for extra in ('src/.ignored.ts', 'public/extra.svg'):
            p = root/extra; p.write_bytes(b'extra')
            with self.assertRaises(AssertionError): assert_worktree_inventory(root, expected)
            p.unlink()
        path.write_bytes(b'stale')
        with self.assertRaises(AssertionError): assert_worktree_inventory(root, expected)
        path.write_bytes(b'exact'); path.chmod(0o755)
        with self.assertRaises(AssertionError): assert_worktree_inventory(root, expected)
        path.chmod(0o644); path.unlink(); path.symlink_to(self.view/MANIFEST)
        with self.assertRaises(AssertionError): assert_worktree_inventory(root, expected)
        path.unlink()
        with self.assertRaises(AssertionError): assert_worktree_inventory(root, expected)

    def test_previous_research_ui_projection_requires_complete_current_verification(self):
        current = {'contract': CONTRACT, 'checks': 193, 'sourceBaseline': REFERENCE, 'manifestSha256': MANIFEST_SHA256}
        with patch(__name__+'.verify_ui_baseline', return_value=current) as verify:
            result = verify_previous_ui_baseline()
            verify.assert_called_once_with()
            self.assertEqual(result['contract'], research.CONTRACT)
            self.assertEqual(result['sourceBaseline'], research.REFERENCE)
            self.assertEqual(result['currentAdoption'], current)
            self.assertEqual(result['approvedSourceDeltaPaths'], list(research.CHANGED_PATHS))
        with patch(__name__+'.verify_ui_baseline', side_effect=AssertionError('Current source changed')):
            with self.assertRaisesRegex(AssertionError, 'Current source changed'): verify_previous_ui_baseline()


class BuildingBatchCommittedCandidateTests(unittest.TestCase):
    def test_actual_committed_candidate_matches_complete_frozen_source(self):
        self.assertEqual(verify_candidate(CANDIDATE)['contract'], CONTRACT)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--build-manifest': build_worktree_manifest(sys.argv[2])
    elif sys.argv[1:] == ['--verify-ui-baseline']: print(json.dumps(verify_ui_baseline(), ensure_ascii=False, indent=2))
    else:
        if len(sys.argv) >= 3 and sys.argv[1] == '--verify-candidate':
            CANDIDATE = sys.argv[2]; del sys.argv[1:3]
        unittest.main()
