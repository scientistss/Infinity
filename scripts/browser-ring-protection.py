"""Verify protected-session ring controls, retaining the original mismatch mode.

Only immutable natural journey saves and ordinary native browser input create game state. Explicit
current-slot write/readback fault injection and a real same-origin second tab
exercise SaveSession. Native Storage delegates unchanged outside labeled faults.
Clocks/RAF/autosave are controlled, as in browser-render-scheduling.py. A CDP
conditional breakpoint reads the actual module state through its existing pure
serializer; it does not modify game state, handlers, or the served bundle.

Baseline mode requires the production tree to match the pinned original and means
baselineKnownLimitationReproduced, never UI correctness. Synchronized mode checks
immediate presentation and bounded recovery, with explicitly labeled synthetic
visibility and stale-enabled event replay. CDP observations remain read-only.
Linux bounded process cleanup is reused from browser-natural-ring.py.

The historical domain-byte guard is retained for unchanged sources. A separately
pinned, exact r10 terraformer delta can establish source provenance only; it never
waives native assertions or retroactively changes earlier failed CI evidence.
A second immutable manifest admits only the exact two-file IRN semantic delta
atop that r10 source. This explicit adoption is not native or CI acceptance.
Demolition has its own exact-file and exact-hunk adoption atop the verified IRN
source. Neither shared-core path is removed from the original protected scope.
NPC adoption separately binds every production path to verified ca5, retaining
all earlier manifest bytes and each original native protection obligation.
Compact report UI adoption composes the unchanged attack seal at exact 7554
with three presentation-only files; every domain and ring byte stays fixed.
Scout/rehearsal adoption separately composes exact cc19 with r14 source bytes,
complete patches and hunks; kernel/economy and all ring scope remain protected.
Scout comparison composes exact e729 with only a frozen four-file presentation
delta; the r14 schema, every historical seal, all domain bytes and art stay fixed.
Formation copy composes exact be0 comparison bytes with only four frozen UI
paths; all eight earlier seals, complete domain, original art and r14 stay fixed.
"""
import argparse
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

REPORT_NAME = 'ring-protection-report.json'
WORK_SECONDS, SUPERVISOR_SECONDS = 210, 225
BASELINE = '7f17a121ff35822a85d6889a9823f76bccbff227'
DOMAIN_ADOPTION = '0c563a6a2bafe70c8a0531dd935d36f9c83917cd'
DOMAIN_PATHS = ('src/game', 'src/core', 'src/data', 'src/automation')
DOMAIN_MANIFEST = 'tests/fixtures/ring-protection-domain-provenance.json'
DOMAIN_MANIFEST_SHA256 = 'f819e5ffa0cca5769b471e4dd2f500f6ba6db0421e349cc9221e1207fd63601c'
IRN_MANIFEST = 'tests/fixtures/research-network-domain-provenance.json'
IRN_MANIFEST_SHA256 = '2fc844f498d43d9f72155943f6f9204f1a26452d4df86da4859320e4df882cb1'
IRN_CHANGED_PATHS = ('src/data/research.ts', 'src/game/research.ts')
DEMOLITION_ADOPTION = 'ac3cce98403bea1e7162bcb4092e4cfeeb448a9a'
DEMOLITION_MANIFEST = 'tests/fixtures/demolition-domain-provenance.json'
# Frozen production delta: any later byte or mode change requires a new explicit adoption.
DEMOLITION_MANIFEST_SHA256 = 'cd90198c4466c1f04e603aad4cb4654b06c98945b9a95b74e0eb7bb26963e529'
DEMOLITION_CHANGED_PATHS = (
    'src/automation/engine.ts',
    'src/core/offline.ts',
    'src/game/building-templates.ts',
    'src/game/content.ts',
    'src/game/demolition-pricing.ts',
    'src/game/demolition-save.ts',
    'src/game/demolition-state.ts',
    'src/game/demolition.ts',
    'src/game/fleet.ts',
    'src/game/logic.ts',
    'src/game/order-ledger.ts',
    'src/game/orders-save.ts',
    'src/game/orders.ts',
    'src/game/paid-job-identity.ts',
    'src/game/planet.ts',
    'src/game/queue.ts',
    'src/game/research.ts',
    'src/game/save-session.ts',
    'src/game/save.ts',
    'src/game/shipyard.ts',
    'src/game/terraformer.ts',
    'src/game/types.ts',
)
DEMOLITION_RING_DELTAS = ('src/automation/engine.ts', 'src/core/offline.ts')
NPC_ADOPTION = 'ca5ef0c769856f2c4c8925e76a5c7d322822fe1b'
NPC_MANIFEST = 'tests/fixtures/npc-domain-provenance.json'
# Frozen ca5-to-NPC source seal; later source changes require a new explicit adoption.
NPC_MANIFEST_SHA256 = 'f611b33ea5cc9e1bbb102e998bbe6515e3821224fd377aac790903328f744c26'
NPC_PRODUCTION_PATHS = ('src',)
NPC_CHANGED_PATHS = (
    'src/game/content.ts',
    'src/game/fleet.ts',
    'src/game/logic.ts',
    'src/game/npc-economy-save.ts',
    'src/game/npc-economy.ts',
    'src/game/npc-scout.ts',
    'src/game/save-session.ts',
    'src/game/save.ts',
    'src/game/state.ts',
    'src/game/types.ts',
)

ATTACK_ADOPTION = 'eefc0706e8bc2ce39fbfd732ab9d3b67ac190d81'
ATTACK_MANIFEST = 'tests/fixtures/npc-attack-domain-provenance.json'
ATTACK_MANIFEST_SHA256 = '66ad64744a04d756f3d3c97812b1d800de18421b1af76dea6fabf63841b14918'
ATTACK_PRODUCTION_PATHS = ('src',)
ATTACK_CHANGED_PATHS = (
    'src/game/content.ts',
    'src/game/fleet.ts',
    'src/game/logic.ts',
    'src/game/npc-attack-state.ts',
    'src/game/npc-attack.ts',
    'src/game/npc-battle.ts',
    'src/game/npc-fuel.ts',
    'src/game/npc-garrison.ts',
    'src/game/npc-loot.ts',
    'src/game/npc-remainder.ts',
    'src/game/npc-scout.ts',
    'src/game/npc-transfer.ts',
    'src/game/npc-wallet.ts',
    'src/game/planet.ts',
    'src/game/save-session.ts',
    'src/game/save.ts',
    'src/game/space-save.ts',
    'src/game/state.ts',
    'src/game/types.ts',
    'src/main.ts',
    'src/space.css',
    'src/ui/npc-attack-controls.ts',
    'src/ui/npc-battle-panel.ts',
    'src/ui/npc-battle-present.ts',
    'src/ui/prestige-preview-model.ts',
    'src/ui/prestige-preview.ts',
    'src/ui/shipyard-panel.ts',
    'src/ui/space-panel.ts',
    'src/ui/space-present.ts',
)
ATTACK_RING_DELTAS = ()

NPC_REPORT_UI_ADOPTION = '7554c662e3ac1f27876a60d8aa706e5d4a4dcd52'
NPC_REPORT_UI_MANIFEST = 'tests/fixtures/npc-report-ui-provenance.json'
# Frozen three-file presentation delta; all five historical seals remain unchanged.
NPC_REPORT_UI_MANIFEST_SHA256 = '6a995501e1136fbf6d1205fa3021851e5c0668c4a55dd5612fc5a7fd08e96fd7'
NPC_REPORT_UI_PRODUCTION_PATHS = ('src',)
NPC_REPORT_UI_CHANGED_PATHS = (
    'src/space.css',
    'src/ui/npc-battle-panel.ts',
    'src/ui/npc-battle-present.ts',
)

NPC_SCOUT_REHEARSAL_ADOPTION = 'cc19bf5e1a459cf8e667ca55f4891ca9ffd25a71'
NPC_SCOUT_REHEARSAL_MANIFEST = 'tests/fixtures/npc-scout-rehearsal-provenance.json'
# Frozen cc19-to-r14 source seal; later byte or mode changes require a new explicit adoption.
NPC_SCOUT_REHEARSAL_MANIFEST_SHA256 = '5f96bf28b60872cee956b05f893bbfbd2972ae866717281b31f8f7ca84c7e05a'
NPC_SCOUT_REHEARSAL_PRODUCTION_PATHS = ('src',)
NPC_SCOUT_REHEARSAL_CHANGED_PATHS = (
    'src/game/content.ts',
    'src/game/fleet.ts',
    'src/game/npc-attack.ts',
    'src/game/npc-rehearsal.ts',
    'src/game/npc-scout-save.ts',
    'src/game/npc-scout-state.ts',
    'src/game/npc-scout.ts',
    'src/game/save.ts',
    'src/game/space-save.ts',
    'src/main.ts',
    'src/ui/npc-rehearsal-panel.ts',
    'src/ui/space-panel.ts',
)
NPC_SCOUT_REHEARSAL_DOMAIN_DELTAS = (
    'src/game/content.ts',
    'src/game/fleet.ts',
    'src/game/npc-attack.ts',
    'src/game/npc-rehearsal.ts',
    'src/game/npc-scout-save.ts',
    'src/game/npc-scout-state.ts',
    'src/game/npc-scout.ts',
    'src/game/save.ts',
    'src/game/space-save.ts',
)
NPC_SCOUT_REHEARSAL_RING_DELTAS = ()
NPC_SCOUT_REHEARSAL_UNCHANGED_PATHS = (
    'src/core', 'src/data', 'src/automation',
    'src/game/encounter-combat.ts', 'src/game/npc-battle.ts',
    'src/game/npc-economy.ts', 'src/game/npc-economy-save.ts',
    'src/game/npc-wallet.ts', 'src/game/npc-garrison.ts',
    'src/game/npc-fuel.ts', 'src/game/npc-loot.ts',
    'src/game/npc-transfer.ts', 'src/game/npc-remainder.ts',
)

NPC_SCOUT_COMPARISON_ADOPTION = 'e729c7ff3c4ef519bfd14da9dc132ba7d971de48'
NPC_SCOUT_COMPARISON_MANIFEST = 'tests/fixtures/npc-scout-comparison-provenance.json'
# Frozen e729-to-comparison UI source seal. It cannot replace the r14 source seal.
NPC_SCOUT_COMPARISON_MANIFEST_SHA256 = '0c83edfe531e27d08936a89fbb7477f41c3e4985bfc33854424b118711699f00'
NPC_SCOUT_COMPARISON_PRODUCTION_PATHS = ('src',)
NPC_SCOUT_COMPARISON_CHANGED_PATHS = (
    'src/ui/npc-scout-comparison-model.ts',
    'src/ui/npc-scout-comparison-panel.ts',
    'src/ui/npc-scout-comparison.css',
    'src/ui/space-panel.ts',
)
NPC_SCOUT_COMPARISON_UNCHANGED_PATHS = (
    'public', 'src/ui/npc-rehearsal-panel.ts',
)

NPC_REHEARSAL_FORMATION_COPY_ADOPTION = 'be0e112b964179fc15b89daa4ae6f6a722b78a92'
NPC_REHEARSAL_FORMATION_COPY_MANIFEST = 'tests/fixtures/npc-rehearsal-formation-copy-provenance.json'
# Frozen be0-to-formation-copy UI source seal; never native, CI or release acceptance.
NPC_REHEARSAL_FORMATION_COPY_MANIFEST_SHA256 = '2143af16367f93160ef9250c18de2e87bb2791f4665159bd3d8f43d8ab9fdb39'
NPC_REHEARSAL_FORMATION_COPY_PRODUCTION_PATHS = ('src', 'public')
NPC_REHEARSAL_FORMATION_COPY_CHANGED_PATHS = (
    'src/space.css',
    'src/ui/npc-rehearsal-formation-model.ts',
    'src/ui/npc-rehearsal-panel.ts',
    'src/ui/space-panel.ts',
)
NPC_REHEARSAL_FORMATION_COPY_UNCHANGED_PATHS = (
    'public', 'src/main.ts',
    'src/ui/npc-battle-panel.ts', 'src/ui/npc-battle-present.ts',
    'src/ui/npc-scout-comparison-model.ts', 'src/ui/npc-scout-comparison-panel.ts',
    'src/ui/npc-scout-comparison.css',
)

LAB_BLOCKERS_ADOPTION = 'c80a6728fe9e1769ca4e67fe794b8f0eedfb8627'
LAB_BLOCKERS_MANIFEST = 'tests/fixtures/lab-blockers-provenance.json'
# Exact read-only UI source adoption, not CI, native or release acceptance.
LAB_BLOCKERS_MANIFEST_SHA256 = 'ea23cbbc562494b2e00ab37eac5f666c2fb2773904f2366d3f3f8b76d4c9afb8'
LAB_BLOCKERS_PRODUCTION_PATHS = ('src', 'public')
LAB_BLOCKERS_CHANGED_PATHS = (
    'src/style.css',
    'src/ui/lab-blockers-model.ts',
    'src/ui/lab-blockers-panel.ts',
    'src/ui/present.ts',
    'src/ui/space-panel.ts',
    'src/ui/view.ts',
)
LAB_BLOCKERS_BASELINE_DELTAS = ('src/style.css', 'src/ui/view.ts')
LAB_BLOCKERS_ORIGINAL_UI_HASHES = {
    'src/style.css': '2dd00ffca8073312192902e411fec5458b1fce8f8b22e57cde960ff07ca624ad',
    'src/ui/view.ts': '4203f3389eada4439e90ee44f852f9b34e09fb95a3c4ba708cfc8388d7a81264',
}
LAB_BLOCKERS_UNCHANGED_PATHS = (
    'public', 'src/main.ts', 'src/space.css',
    'src/ui/npc-battle-panel.ts', 'src/ui/npc-battle-present.ts',
    'src/ui/npc-scout-comparison-model.ts', 'src/ui/npc-scout-comparison-panel.ts',
    'src/ui/npc-scout-comparison.css', 'src/ui/npc-rehearsal-formation-model.ts',
    'src/ui/npc-rehearsal-panel.ts',
)

RING_CRITICAL_PATHS = ('src/core', 'src/automation', 'src/game/arcade.ts',
                       'src/data/arcade.ts', 'src/data/protocol-cards.ts', 'src/data/ring-art.json',
                       'src/ui/arcade-panel.ts', 'src/ui/arcade-present.ts',
                       'src/ui/ring-auto-model.ts', 'src/ui/ring-model.ts')
NAMES = {'equipped': '08-equipped-off-current-three-tickets',
         'armed': '10-armed-two-existing-tickets-fixed-home-source',
         'before_stop': '13-armed-before-explicit-stop'}
RECOVERY_NAMES = {'stopped': '14-stopped-unspent-existing-tickets',
                  'curved': '16-after-curvature-old-batch-and-slot-disabled'}
MUTATORS = '[data-action="arcade-run"], [data-action="arcade-all"], [data-action="arcade-bet"], [data-action="arcade-bet-clear"], [data-action="arcade-topup"], [data-ring="auto-arm"], [data-ring="auto-stop"], #ring-auto-slot, #ring-auto-count, #ring-auto-cap'
RESULTS = {'baseline-mismatch': 'baselineKnownLimitationReproduced',
           'synchronized-controls': 'synchronizedControlsVerified'}
CONTROLS = {
    'manual-run': '[data-action="arcade-run"]',
    'manual-all': '[data-action="arcade-all"]',
    'bet-plus': '[data-action="arcade-bet"][data-symbol="metal"][data-delta="1"]',
    'bet-minus': '[data-action="arcade-bet"][data-symbol="metal"][data-delta="-1"]',
    'clear': '[data-action="arcade-bet-clear"]',
    'topup': '[data-action="arcade-topup"]',
    'auto-arm': '[data-ring="auto-arm"]',
    'auto-stop': '[data-ring="auto-stop"]',
    'slot': '#ring-auto-slot', 'count': '#ring-auto-count', 'cap': '#ring-auto-cap',
}

def sha(value):
    return hashlib.sha256(value.encode('utf-8') if isinstance(value, str) else value).hexdigest()


def production_action_handlers(text):
    """Locate the complete original recovery guard, never a generic function prefix.

    The verified r11 Vite bundle adds uninitialized optional-chain temporaries
    before cancelPendingImport. Only a bare var identifier list is admitted;
    initializers, calls and other extra statements remain outside this grammar.
    The complete action list, same-input test, same-session refusal and original
    state/unlocked binding must all match. Runtime still requires one candidate
    and one real CDP location; this parser never executes or rewrites JavaScript.
    """
    identifier = r'[A-Za-z_$][A-Za-z0-9_$]*'
    recovery = r'\["save","export","export-legacy","import-text","import-file","reset","dismiss-notice","dismiss-offline"\]'
    pattern = (
        rf'(?<![\w$])async function (?P<name>{identifier})\((?P<action>{identifier})\)\{{'
        rf'(?:var {identifier}(?:,{identifier})*;)?'
        # r14's sole retirement prefix adds no captures: native groups 1/2/3 stay name/action/session.
        rf'(?:\["import-text","import-file","reset","prestige"\]'
        rf'\.includes\((?P=action)\.type\)&&{identifier}\.retireNpcRehearsal\(\),)?'
        rf'(?P<session>{identifier})\.cancelPendingImport\(\);'
        rf'const (?P<recovery>{identifier})={recovery}\.includes\((?P=action)\.type\);'
        rf'if\((?P=session)\.mode!=="ready"&&!(?P=recovery)\)\{{'
        rf'{identifier}=(?P=session)\.message,{identifier}\(\);return\}}'
        rf'(?=const {identifier}=(?P<state>{identifier}),{identifier}=(?P=state)\.unlocked;)'
    )
    return list(re.finditer(pattern, text))


def production_serializers(text):
    """Recognize only the complete pinned r9/r10/r11/r12 serializeState return shape.

    This is deliberately not a general JS parser. Source provenance and exact
    HTTP/V8/release hashes still establish the helpers' production identity.
    Match every field and its original argument, with no additional statements,
    assignments or arbitrary expressions in this read-only wrapper. The admitted
    additions are r10's fixed terraformer floor and r12's exact first NPC call. Every old field and argument remains mandatory.
    """
    identifier = r'[A-Za-z_$][A-Za-z0-9_$]*'
    state = r'(?P=state)'

    def call(field):
        return rf'{field}:{identifier}\({state}\.{field}\)'

    def copy(field):
        return rf'{field}:\{{\.\.\.{state}\.{field}\}}'

    def direct(field):
        return rf'{field}:{state}\.{field}'

    fields = [
        *(call(field) for field in ('buildingTemplates', 'formations', 'researchTemplates', 'orders')),
        rf'planets:{state}\.planets\.map\({identifier}\)',
        direct('activePlanetId'), rf'deepSpace:structuredClone\({state}\.deepSpace\)',
        copy('universe'), call('fleets'),
        rf'messages:{state}\.messages\.map\((?P<message>{identifier})=>\(\{{\.\.\.(?P=message)\}}\)\)',
        direct('nextFleetId'), call('research'),
        rf'darkMatter:(?P<big>{identifier})\({state}\.darkMatter\)', copy('items'),
        rf'boosters:{state}\.boosters\.map\((?P<booster>{identifier})=>\(\{{\.\.\.(?P=booster)\}}\)\)',
        call('arcade'), call('lifetime'), rf'warpCores:(?P=big)\({state}\.warpCores\)',
        copy('curvature'), rf'totalTime:(?P=big)\({state}\.totalTime\)',
        *(direct(field) for field in ('manualClicks', 'seenEnergyShortage', 'hasPrestiged')),
        rf'unlockedCards:{state}\.unlockedCards\.slice\(\)', call('protocols'),
        rf'unlocked:{state}\.unlocked\.slice\(\)', copy('stats'), direct('offlineBonusHours'),
    ]
    prefix = (rf'(?<![\w$])(?<!async )function (?P<name>{identifier})\((?P<state>{identifier})\)\{{'
              rf'(?:{identifier}\({state},!1\)(?:;|,){identifier}\({state}\);'
              rf'const (?P<context>{identifier})={identifier}\({state}\.universe\.seed,(?:512|{identifier}),'
              rf'{state}\.planets\.map\((?P<planet>{identifier})=>(?P=planet)\.coordinates\)\);'
              rf'return\{{npcEconomy:{identifier}\({state}\.npcEconomy,(?P=context)\),'
              rf'npcBattles:{identifier}\({state}\.npcBattles,(?P=context)\),'
              rf'terraformerGrantJobFloor:{identifier}\({state}\.terraformerGrantJobFloor,{state}\.orders\.nextJobId\),'
              rf'|return\{{(?:(?:npcEconomy:{identifier}\({state}\.npcEconomy\),)?'
              rf'terraformerGrantJobFloor:{identifier}\({state}\.terraformerGrantJobFloor,'
              rf'{state}\.orders\.nextJobId\),)?)')
    return list(re.finditer(prefix + ','.join(fields) + r'\}\}', text)) + scout_production_serializers(text)


def scout_production_serializers(text):
    """Exact r14 wrapper: reject, detached messages, old validation, scout links.

    Every returned field is still mandatory. The messages local is bound at its
    declaration, reference validation and return; no arbitrary prefix or helper
    body is admitted. Runtime source/HTTP/V8 hashes remain the identity proof.
    """
    identifier = r'[A-Za-z_$][A-Za-z0-9_$]*'
    state = r'(?P=state)'

    def call(field):
        return rf'{field}:{identifier}\({state}\.{field}\)'

    def copy(field):
        return rf'{field}:\{{\.\.\.{state}\.{field}\}}'

    def direct(field):
        return rf'{field}:{state}\.{field}'

    fields = [
        *(call(field) for field in ('buildingTemplates', 'formations', 'researchTemplates', 'orders')),
        rf'planets:{state}\.planets\.map\({identifier}\)',
        direct('activePlanetId'), rf'deepSpace:structuredClone\({state}\.deepSpace\)',
        copy('universe'), call('fleets'),
        r'messages:(?P=messages)',
        direct('nextFleetId'), call('research'),
        rf'darkMatter:(?P<big>{identifier})\({state}\.darkMatter\)', copy('items'),
        rf'boosters:{state}\.boosters\.map\((?P<booster>{identifier})=>\(\{{\.\.\.(?P=booster)\}}\)\)',
        call('arcade'), call('lifetime'), rf'warpCores:(?P=big)\({state}\.warpCores\)',
        copy('curvature'), rf'totalTime:(?P=big)\({state}\.totalTime\)',
        *(direct(field) for field in ('manualClicks', 'seenEnergyShortage', 'hasPrestiged')),
        rf'unlockedCards:{state}\.unlockedCards\.slice\(\)', call('protocols'),
        rf'unlocked:{state}\.unlocked\.slice\(\)', copy('stats'), direct('offlineBonusHours'),
    ]
    prefix = (rf'(?<![\w$])(?<!async )function (?P<name>{identifier})\((?P<state>{identifier})\)\{{'
              rf'{identifier}\({state},!1\);'
              rf'const (?P<messages>{identifier})={identifier}\({state}\.messages\);'
              rf'{identifier}\({state},!1\)(?:;|,){identifier}\({state}\)(?:;|,)'
              rf'{identifier}\({state},(?P=messages)\);'
              rf'const (?P<context>{identifier})={identifier}\({state}\.universe\.seed,(?:512|{identifier}),'
              rf'{state}\.planets\.map\((?P<planet>{identifier})=>(?P=planet)\.coordinates\)\);'
              rf'return\{{npcEconomy:{identifier}\({state}\.npcEconomy,(?P=context)\),'
              rf'npcBattles:{identifier}\({state}\.npcBattles,(?P=context)\),'
              rf'terraformerGrantJobFloor:{identifier}\({state}\.terraformerGrantJobFloor,{state}\.orders\.nextJobId\),')
    return list(re.finditer(prefix + ','.join(fields) + r'\}\}', text))


def synchronized_domain_provenance(repository, candidate, git, check):
    """Verify exact source identity, independently of the later native assertions."""
    if candidate != LAB_BLOCKERS_ADOPTION and git('ls-tree', candidate, '--', LAB_BLOCKERS_MANIFEST):
        return lab_blockers_provenance(repository, candidate, git, check)
    if candidate != NPC_REHEARSAL_FORMATION_COPY_ADOPTION and git('ls-tree', candidate, '--', NPC_REHEARSAL_FORMATION_COPY_MANIFEST):
        return npc_rehearsal_formation_copy_provenance(repository, candidate, git, check)
    if candidate != NPC_SCOUT_COMPARISON_ADOPTION and git('ls-tree', candidate, '--', NPC_SCOUT_COMPARISON_MANIFEST):
        return npc_scout_comparison_provenance(repository, candidate, git, check)
    if candidate != NPC_SCOUT_REHEARSAL_ADOPTION and git('ls-tree', candidate, '--', NPC_SCOUT_REHEARSAL_MANIFEST):
        return npc_scout_rehearsal_provenance(repository, candidate, git, check)
    if candidate != NPC_REPORT_UI_ADOPTION and git('ls-tree', candidate, '--', NPC_REPORT_UI_MANIFEST):
        return npc_report_ui_provenance(repository, candidate, git, check)
    if candidate != ATTACK_ADOPTION and git('ls-tree', candidate, '--', ATTACK_MANIFEST):
        return npc_attack_domain_provenance(repository, candidate, git, check)
    if candidate != NPC_ADOPTION and git('ls-tree', candidate, '--', NPC_MANIFEST):
        return npc_domain_provenance(repository, candidate, git, check)
    if candidate != DEMOLITION_ADOPTION and git('ls-tree', candidate, '--', DEMOLITION_MANIFEST):
        return demolition_domain_provenance(repository, candidate, git, check)

    def changed(before, after, paths):
        return git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
                   before, after, '--', *paths).decode().splitlines()

    original_delta = changed(BASELINE, candidate, DOMAIN_PATHS)
    if not original_delta:
        check('synchronization preserves original domain, economy, automation and SaveSession bytes', True)
        return {'contract': 'historical-domain-byte-identity', 'historicalBaselineSha': BASELINE,
                'historicalDomainByteIdentity': True, 'candidateSourceSha': candidate}

    raw = (repository / DOMAIN_MANIFEST).read_bytes()
    check('r10 adoption manifest matches its fixed SHA256 and exact committed candidate bytes',
          sha(raw) == DOMAIN_MANIFEST_SHA256 and raw == git('show', candidate+':'+DOMAIN_MANIFEST))
    manifest = json.loads(raw)
    check('r10 adoption pins the historical root, declared reference and complete domain scope',
          manifest.get('schema') == 'infinity-ring-protection-domain-provenance-v1'
          and manifest.get('historicalBaselineSha') == BASELINE
          and manifest.get('declaredAdoptionSourceSha') == DOMAIN_ADOPTION
          and manifest.get('domainPaths') == list(DOMAIN_PATHS)
          and manifest.get('unchangedRingCriticalPaths') == list(RING_CRITICAL_PATHS))

    def entry(ref, path):
        value = git('ls-tree', ref, '--', path)
        if not value:
            return None
        mode, kind, oid = value.decode().split('\t')[0].split()
        if kind != 'blob':
            raise AssertionError('Declared domain path must be a file: '+path)
        return {'mode': mode, 'sha256': sha(git('cat-file', 'blob', oid))}

    declared_delta = changed(BASELINE, DOMAIN_ADOPTION, DOMAIN_PATHS)
    actual_rows = [{'path': path, 'before': entry(BASELINE, path),
                    'after': entry(DOMAIN_ADOPTION, path)} for path in declared_delta]
    check('only the exact recorded r10 paths, file modes and before/after bytes differ from 7f17',
          manifest.get('changedPaths') == actual_rows)
    irn_delta = changed(DOMAIN_ADOPTION, candidate, DOMAIN_PATHS)
    if irn_delta:
        # New semantic adoption, not a relaxation of the original r10 identity branch.
        # Bind the eventual candidate's Git blobs, not mutable worktree source bytes.
        irn_raw = (repository / IRN_MANIFEST).read_bytes()
        check('IRN semantic adoption manifest matches its fixed SHA256 and exact committed candidate bytes',
              sha(irn_raw) == IRN_MANIFEST_SHA256 and irn_raw == git('show', candidate+':'+IRN_MANIFEST))
        irn_manifest = json.loads(irn_raw)
        check('IRN semantic adoption pins the historical root, r10 reference, prior manifest and complete domain scope',
              irn_manifest.get('schema') == 'infinity-ring-protection-research-network-provenance-v1'
              and irn_manifest.get('historicalBaselineSha') == BASELINE
              and irn_manifest.get('previousAdoptionSourceSha') == DOMAIN_ADOPTION
              and irn_manifest.get('previousAdoptionManifestSha256') == DOMAIN_MANIFEST_SHA256
              and irn_manifest.get('domainPaths') == list(DOMAIN_PATHS)
              and irn_manifest.get('unchangedRingCriticalPaths') == list(RING_CRITICAL_PATHS))
        check('candidate complete domain differs from r10 only at the exact two declared IRN paths',
              irn_delta == list(IRN_CHANGED_PATHS))
        irn_rows = [{'path': path, 'before': entry(DOMAIN_ADOPTION, path),
                     'after': entry(candidate, path)} for path in irn_delta]
        check('both IRN files match immutable before/after bytes and file modes',
              irn_manifest.get('changedPaths') == irn_rows)
        check('original ring logic, automation, clocks, cards and unchanged ring models retain 7f17 bytes',
              changed(BASELINE, candidate, RING_CRITICAL_PATHS) == [])
        return {'contract': 'exact-declared-irn-semantic-delta', 'historicalBaselineSha': BASELINE,
                'historicalDomainByteIdentity': False, 'historicalChangedPaths': original_delta,
                'previousAdoptionSourceSha': DOMAIN_ADOPTION, 'candidateSourceSha': candidate,
                'previousManifestPath': DOMAIN_MANIFEST, 'previousManifestSha256': sha(raw),
                'previousManifest': manifest, 'manifestPath': IRN_MANIFEST,
                'manifestSha256': sha(irn_raw), 'manifest': irn_manifest,
                'verificationScope': 'Explicit IRN semantic source adoption only; not a passing CI or native acceptance claim. All native protection and recovery assertions remain required.'}
    check('candidate complete domain tree byte-matches the declared r10 source without additional changes',
          changed(DOMAIN_ADOPTION, candidate, DOMAIN_PATHS) == [])
    check('original ring logic, automation, clocks, cards and unchanged ring models retain 7f17 bytes',
          changed(BASELINE, candidate, RING_CRITICAL_PATHS) == [])
    return {'contract': 'exact-declared-r10-terraformer-delta', 'historicalBaselineSha': BASELINE,
            'historicalDomainByteIdentity': False, 'historicalChangedPaths': original_delta,
            'declaredAdoptionSourceSha': DOMAIN_ADOPTION, 'candidateSourceSha': candidate,
            'manifestPath': DOMAIN_MANIFEST, 'manifestSha256': sha(raw), 'manifest': manifest,
            'verificationScope': 'Source provenance only; all native protection and recovery assertions remain required.'}


def source_delta_patch(git, before, after, path):
    """A deterministic per-file Git patch, including modes and full object IDs."""
    return git('diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color',
               '--full-index', '--binary', '--diff-algorithm=myers', '--no-indent-heuristic',
               '--unified=3', '--inter-hunk-context=0', '--no-relative',
               '--src-prefix=a/', '--dst-prefix=b/', '--line-prefix=',
               '--output-indicator-new=+', '--output-indicator-old=-', '--output-indicator-context= ',
               before, after, '--', path)


def source_delta_hunks(patch):
    """Pin every complete patch hunk, not merely a count or a permitted directory."""
    lines = patch.splitlines(keepends=True)
    starts = [index for index, line in enumerate(lines) if line.startswith(b'@@ ')]
    return [{'header': lines[start].decode('utf-8').rstrip('\n'),
             'sha256': sha(b''.join(lines[start:starts[index + 1] if index + 1 < len(starts) else len(lines)]))}
            for index, start in enumerate(starts)]


def demolition_domain_provenance(repository, candidate, git, check):
    """Adopt only a frozen demolition delta; retain both earlier contracts verbatim."""
    # Critically, validate the prior IRN source itself. The demolition candidate
    # must never be passed off as the old two-file r10-to-IRN semantic delta.
    prior = synchronized_domain_provenance(repository, DEMOLITION_ADOPTION, git, check)
    check('demolition adoption starts at the exact independently verified IRN source contract',
          prior['contract'] == 'exact-declared-irn-semantic-delta'
          and prior['candidateSourceSha'] == DEMOLITION_ADOPTION)

    def changed(before, after, paths):
        return git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
                   before, after, '--', *paths).decode().splitlines()

    def entry(ref, path):
        value = git('ls-tree', ref, '--', path)
        if not value:
            return None
        mode, kind, oid = value.decode().split('\t')[0].split()
        if kind != 'blob':
            raise AssertionError('Declared demolition path must be a file: ' + path)
        return {'mode': mode, 'sha256': sha(git('cat-file', 'blob', oid))}

    for path, digest in ((DOMAIN_MANIFEST, DOMAIN_MANIFEST_SHA256), (IRN_MANIFEST, IRN_MANIFEST_SHA256)):
        check('demolition candidate preserves the complete earlier manifest bytes and mode: ' + path,
              entry(candidate, path) == entry(DEMOLITION_ADOPTION, path) == {'mode': '100644', 'sha256': digest})
    raw = (repository / DEMOLITION_MANIFEST).read_bytes()
    check('demolition adoption manifest has the immutable approved digest and committed ordinary-file bytes',
          sha(raw) == DEMOLITION_MANIFEST_SHA256
          and entry(candidate, DEMOLITION_MANIFEST) == {'mode': '100644', 'sha256': DEMOLITION_MANIFEST_SHA256}
          and raw == git('show', candidate + ':' + DEMOLITION_MANIFEST))
    manifest = json.loads(raw)
    check('demolition adoption pins every historical source, manifest and original protection scope',
          manifest.get('schema') == 'infinity-ring-protection-demolition-provenance-v1'
          and manifest.get('historicalBaselineSha') == BASELINE
          and manifest.get('previousAdoptionSourceSha') == DEMOLITION_ADOPTION
          and manifest.get('previousManifests') == [
              {'path': DOMAIN_MANIFEST, 'sha256': DOMAIN_MANIFEST_SHA256},
              {'path': IRN_MANIFEST, 'sha256': IRN_MANIFEST_SHA256}]
          and manifest.get('domainPaths') == list(DOMAIN_PATHS)
          and manifest.get('originalRingCriticalPaths') == list(RING_CRITICAL_PATHS)
          and manifest.get('exactRingCriticalDeltaPaths') == list(DEMOLITION_RING_DELTAS))
    delta = changed(DEMOLITION_ADOPTION, candidate, DOMAIN_PATHS)
    check('entire protected domain differs from IRN only at the frozen approved demolition files',
          bool(DEMOLITION_CHANGED_PATHS) and delta == list(DEMOLITION_CHANGED_PATHS))
    rows = []
    for path in delta:
        patch = source_delta_patch(git, DEMOLITION_ADOPTION, candidate, path)
        rows.append({'path': path, 'before': entry(DEMOLITION_ADOPTION, path),
                     'after': entry(candidate, path), 'patchSha256': sha(patch),
                     'hunks': source_delta_hunks(patch)})
    check('every demolition file, mode, complete patch and individual hunk matches its immutable record',
          manifest.get('changedPaths') == rows)
    check('original complete ring-critical scope permits only the two exact recorded shared-source deltas',
          changed(BASELINE, candidate, RING_CRITICAL_PATHS) == list(DEMOLITION_RING_DELTAS)
          and all(path in delta for path in DEMOLITION_RING_DELTAS))
    return {'contract': 'exact-declared-demolition-semantic-delta',
            'historicalBaselineSha': BASELINE, 'historicalDomainByteIdentity': False,
            'previousAdoptionSourceSha': DEMOLITION_ADOPTION, 'candidateSourceSha': candidate,
            'historicalChangedPaths': changed(BASELINE, candidate, DOMAIN_PATHS),
            'previousProvenance': prior, 'manifestPath': DEMOLITION_MANIFEST,
            'manifestSha256': sha(raw), 'manifest': manifest,
            'verificationScope': 'Exact demolition semantic source adoption only. All original ring native UI/handler protection and recovery assertions, plus the separate demolition native UI/handler guards, remain required. Source identity is not native or CI acceptance.'}


def npc_domain_provenance(repository, candidate, git, check):
    """One explicit ca5-to-r12 source adoption; no historical contract is widened."""
    prior = demolition_domain_provenance(repository, NPC_ADOPTION, git, check)
    check('NPC adoption starts at the exact independently verified ca5 demolition source',
          prior['contract'] == 'exact-declared-demolition-semantic-delta'
          and prior['candidateSourceSha'] == NPC_ADOPTION)

    def changed(before, after, paths):
        return git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
                   before, after, '--', *paths).decode().splitlines()

    def entry(ref, path):
        value = git('ls-tree', ref, '--', path)
        if not value:
            return None
        mode, kind, oid = value.decode().split('\t')[0].split()
        if kind != 'blob':
            raise AssertionError('Declared NPC path must be a file: ' + path)
        return {'mode': mode, 'sha256': sha(git('cat-file', 'blob', oid))}

    previous = [(DOMAIN_MANIFEST, DOMAIN_MANIFEST_SHA256), (IRN_MANIFEST, IRN_MANIFEST_SHA256),
                (DEMOLITION_MANIFEST, DEMOLITION_MANIFEST_SHA256)]
    for path, digest in previous:
        check('NPC candidate preserves complete earlier manifest bytes and mode: ' + path,
              entry(candidate, path) == entry(NPC_ADOPTION, path) == {'mode': '100644', 'sha256': digest})
    raw = (repository / NPC_MANIFEST).read_bytes()
    check('NPC manifest has immutable approved digest and exact committed ordinary-file bytes',
          sha(raw) == NPC_MANIFEST_SHA256
          and entry(candidate, NPC_MANIFEST) == {'mode': '100644', 'sha256': NPC_MANIFEST_SHA256}
          and raw == git('show', candidate + ':' + NPC_MANIFEST))
    manifest = json.loads(raw)
    check('NPC adoption pins ca5, all prior manifests, complete source and original protected scopes',
          manifest.get('schema') == 'infinity-ring-protection-npc-provenance-v1'
          and manifest.get('historicalBaselineSha') == BASELINE
          and manifest.get('previousAdoptionSourceSha') == NPC_ADOPTION
          and manifest.get('previousManifests') == [{'path': path, 'sha256': digest} for path, digest in previous]
          and manifest.get('productionPaths') == list(NPC_PRODUCTION_PATHS)
          and manifest.get('domainPaths') == list(DOMAIN_PATHS)
          and manifest.get('originalRingCriticalPaths') == list(RING_CRITICAL_PATHS)
          and manifest.get('exactRingCriticalDeltaPaths') == [])
    delta = changed(NPC_ADOPTION, candidate, NPC_PRODUCTION_PATHS)
    check('complete production tree differs from ca5 only at exactly approved NPC files',
          bool(NPC_CHANGED_PATHS) and delta == list(NPC_CHANGED_PATHS))
    rows = []
    for path in delta:
        patch = source_delta_patch(git, NPC_ADOPTION, candidate, path)
        rows.append({'path': path, 'before': entry(NPC_ADOPTION, path),
                     'after': entry(candidate, path), 'patchSha256': sha(patch),
                     'hunks': source_delta_hunks(patch)})
    check('every NPC file, mode, complete patch and individual hunk matches immutable approval',
          manifest.get('changedPaths') == rows)
    check('NPC adoption leaves the entire original ring-critical scope byte-identical to verified ca5',
          changed(NPC_ADOPTION, candidate, RING_CRITICAL_PATHS) == [])
    return {'contract': 'exact-declared-npc-semantic-delta',
            'historicalBaselineSha': BASELINE, 'historicalDomainByteIdentity': False,
            'previousAdoptionSourceSha': NPC_ADOPTION, 'candidateSourceSha': candidate,
            'historicalChangedPaths': changed(BASELINE, candidate, DOMAIN_PATHS),
            'previousProvenance': prior, 'manifestPath': NPC_MANIFEST,
            'manifestSha256': sha(raw), 'manifest': manifest,
            'verificationScope': 'Exact NPC source adoption only; not native or CI acceptance. Every original protection, recovery, full-state and new NPC native assertion remains required.'}


def npc_attack_domain_provenance(repository, candidate, git, check):
    """One explicit eef-to-r13 source adoption; no historical contract is widened."""
    prior = npc_domain_provenance(repository, ATTACK_ADOPTION, git, check)
    check('NPC attack adoption starts at the exact independently verified eef demolition source',
          prior['contract'] == 'exact-declared-npc-semantic-delta'
          and prior['candidateSourceSha'] == ATTACK_ADOPTION)

    def changed(before, after, paths):
        return git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
                   before, after, '--', *paths).decode().splitlines()

    def entry(ref, path):
        value = git('ls-tree', ref, '--', path)
        if not value:
            return None
        mode, kind, oid = value.decode().split('\t')[0].split()
        if kind != 'blob':
            raise AssertionError('Declared NPC path must be a file: ' + path)
        return {'mode': mode, 'sha256': sha(git('cat-file', 'blob', oid))}

    previous = [(DOMAIN_MANIFEST, DOMAIN_MANIFEST_SHA256), (IRN_MANIFEST, IRN_MANIFEST_SHA256),
                (DEMOLITION_MANIFEST, DEMOLITION_MANIFEST_SHA256), (NPC_MANIFEST, NPC_MANIFEST_SHA256)]
    for path, digest in previous:
        check('NPC candidate preserves complete earlier manifest bytes and mode: ' + path,
              entry(candidate, path) == entry(ATTACK_ADOPTION, path) == {'mode': '100644', 'sha256': digest})
    raw = (repository / ATTACK_MANIFEST).read_bytes()
    check('NPC manifest has immutable approved digest and exact committed ordinary-file bytes',
          sha(raw) == ATTACK_MANIFEST_SHA256
          and entry(candidate, ATTACK_MANIFEST) == {'mode': '100644', 'sha256': ATTACK_MANIFEST_SHA256}
          and raw == git('show', candidate + ':' + ATTACK_MANIFEST))
    manifest = json.loads(raw)
    check('NPC attack adoption pins eef, all prior manifests, complete source and original protected scopes',
          manifest.get('schema') == 'infinity-ring-protection-npc-attack-provenance-v1'
          and manifest.get('historicalBaselineSha') == BASELINE
          and manifest.get('previousAdoptionSourceSha') == ATTACK_ADOPTION
          and manifest.get('previousManifests') == [{'path': path, 'sha256': digest} for path, digest in previous]
          and manifest.get('productionPaths') == list(ATTACK_PRODUCTION_PATHS)
          and manifest.get('domainPaths') == list(DOMAIN_PATHS)
          and manifest.get('originalRingCriticalPaths') == list(RING_CRITICAL_PATHS)
          and manifest.get('exactRingCriticalDeltaPaths') == list(ATTACK_RING_DELTAS))
    delta = changed(ATTACK_ADOPTION, candidate, ATTACK_PRODUCTION_PATHS)
    check('complete production tree differs from eef only at exactly approved NPC files',
          bool(ATTACK_CHANGED_PATHS) and delta == list(ATTACK_CHANGED_PATHS))
    rows = []
    for path in delta:
        patch = source_delta_patch(git, ATTACK_ADOPTION, candidate, path)
        rows.append({'path': path, 'before': entry(ATTACK_ADOPTION, path),
                     'after': entry(candidate, path), 'patchSha256': sha(patch),
                     'hunks': source_delta_hunks(patch)})
    check('every NPC file, mode, complete patch and individual hunk matches immutable approval',
          manifest.get('changedPaths') == rows)
    check('NPC attack adoption leaves the entire original ring-critical scope byte-identical to verified eef',
          changed(ATTACK_ADOPTION, candidate, RING_CRITICAL_PATHS) == list(ATTACK_RING_DELTAS)
          and all(path in delta for path in ATTACK_RING_DELTAS))
    return {'contract': 'exact-declared-npc-attack-semantic-delta',
            'historicalBaselineSha': BASELINE, 'historicalDomainByteIdentity': False,
            'previousAdoptionSourceSha': ATTACK_ADOPTION, 'candidateSourceSha': candidate,
            'historicalChangedPaths': changed(BASELINE, candidate, DOMAIN_PATHS),
            'previousProvenance': prior, 'manifestPath': ATTACK_MANIFEST,
            'manifestSha256': sha(raw), 'manifest': manifest,
            'verificationScope': 'Exact NPC source adoption only; not native or CI acceptance. Every original protection, recovery, full-state and new NPC native assertion remains required.'}


def npc_report_ui_provenance(repository, candidate, git, check):
    """Compose the unchanged attack seal with only the frozen three-file UI delta."""
    prior = npc_attack_domain_provenance(repository, NPC_REPORT_UI_ADOPTION, git, check)
    check('compact NPC report UI starts at the exact independently sealed 7554 attack source',
          prior['contract'] == 'exact-declared-npc-attack-semantic-delta'
          and prior['candidateSourceSha'] == NPC_REPORT_UI_ADOPTION)

    def changed(before, after, paths):
        return git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
                   before, after, '--', *paths).decode().splitlines()

    def entry(ref, path):
        value = git('ls-tree', ref, '--', path)
        if not value:
            return None
        mode, kind, oid = value.decode().split('\t')[0].split()
        if kind != 'blob':
            raise AssertionError('Declared NPC report UI path must be a file: ' + path)
        return {'mode': mode, 'sha256': sha(git('cat-file', 'blob', oid))}

    previous = [(DOMAIN_MANIFEST, DOMAIN_MANIFEST_SHA256), (IRN_MANIFEST, IRN_MANIFEST_SHA256),
                (DEMOLITION_MANIFEST, DEMOLITION_MANIFEST_SHA256), (NPC_MANIFEST, NPC_MANIFEST_SHA256),
                (ATTACK_MANIFEST, ATTACK_MANIFEST_SHA256)]
    for path, digest in previous:
        check('compact NPC report UI preserves every earlier manifest byte and mode: ' + path,
              entry(candidate, path) == entry(NPC_REPORT_UI_ADOPTION, path)
              == {'mode': '100644', 'sha256': digest})
    raw = (repository / NPC_REPORT_UI_MANIFEST).read_bytes()
    check('compact NPC report UI manifest has its fixed digest and exact committed ordinary-file bytes',
          sha(raw) == NPC_REPORT_UI_MANIFEST_SHA256
          and entry(candidate, NPC_REPORT_UI_MANIFEST) == {'mode': '100644', 'sha256': NPC_REPORT_UI_MANIFEST_SHA256}
          and raw == git('show', candidate + ':' + NPC_REPORT_UI_MANIFEST))
    manifest = json.loads(raw)
    check('compact NPC report UI pins 7554, all prior seals and the complete production and protected scopes',
          manifest.get('schema') == 'infinity-ring-protection-npc-report-ui-provenance-v1'
          and manifest.get('historicalBaselineSha') == BASELINE
          and manifest.get('previousAdoptionSourceSha') == NPC_REPORT_UI_ADOPTION
          and manifest.get('previousManifests') == [{'path': path, 'sha256': digest} for path, digest in previous]
          and manifest.get('productionPaths') == list(NPC_REPORT_UI_PRODUCTION_PATHS)
          and manifest.get('domainPaths') == list(DOMAIN_PATHS)
          and manifest.get('originalRingCriticalPaths') == list(RING_CRITICAL_PATHS)
          and manifest.get('exactDomainDeltaPaths') == []
          and manifest.get('exactRingCriticalDeltaPaths') == [])
    delta = changed(NPC_REPORT_UI_ADOPTION, candidate, NPC_REPORT_UI_PRODUCTION_PATHS)
    check('complete production tree differs from 7554 only at the exact three compact report UI files',
          delta == list(NPC_REPORT_UI_CHANGED_PATHS))
    rows = []
    for path in delta:
        patch = source_delta_patch(git, NPC_REPORT_UI_ADOPTION, candidate, path)
        rows.append({'path': path, 'before': entry(NPC_REPORT_UI_ADOPTION, path),
                     'after': entry(candidate, path), 'patchSha256': sha(patch),
                     'hunks': source_delta_hunks(patch)})
    check('each report UI mode, byte, full patch and hunk is exact and anchored in sealed 7554 bytes',
          manifest.get('changedPaths') == rows)
    check('compact NPC report UI preserves the entire domain and original ring-critical source scopes',
          changed(NPC_REPORT_UI_ADOPTION, candidate, DOMAIN_PATHS) == []
          and changed(NPC_REPORT_UI_ADOPTION, candidate, RING_CRITICAL_PATHS) == [])
    return {'contract': 'exact-declared-npc-report-ui-delta',
            'historicalBaselineSha': BASELINE, 'historicalDomainByteIdentity': False,
            'previousAdoptionSourceSha': NPC_REPORT_UI_ADOPTION, 'candidateSourceSha': candidate,
            'historicalChangedPaths': changed(BASELINE, candidate, DOMAIN_PATHS),
            'previousProvenance': prior, 'manifestPath': NPC_REPORT_UI_MANIFEST,
            'manifestSha256': sha(raw), 'manifest': manifest,
            'verificationScope': 'Exact compact NPC report UI source adoption only; not native or CI acceptance. Every historical protection, recovery, full-state and NPC native assertion remains required.'}


def npc_scout_rehearsal_provenance(repository, candidate, git, check):
    """Compose immutable cc19 with the exact r14 scout/rehearsal source delta."""
    prior = npc_report_ui_provenance(repository, NPC_SCOUT_REHEARSAL_ADOPTION, git, check)
    check('NPC scout/rehearsal starts at the exact independently sealed cc19 compact report source',
          prior['contract'] == 'exact-declared-npc-report-ui-delta'
          and prior['candidateSourceSha'] == NPC_SCOUT_REHEARSAL_ADOPTION)

    def changed(before, after, paths):
        return git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
                   before, after, '--', *paths).decode().splitlines()

    def entry(ref, path):
        value = git('ls-tree', ref, '--', path)
        if not value:
            return None
        mode, kind, oid = value.decode().split('\t')[0].split()
        if kind != 'blob':
            raise AssertionError('Declared NPC scout/rehearsal path must be a file: ' + path)
        return {'mode': mode, 'sha256': sha(git('cat-file', 'blob', oid))}

    previous = [(DOMAIN_MANIFEST, DOMAIN_MANIFEST_SHA256), (IRN_MANIFEST, IRN_MANIFEST_SHA256),
                (DEMOLITION_MANIFEST, DEMOLITION_MANIFEST_SHA256), (NPC_MANIFEST, NPC_MANIFEST_SHA256),
                (ATTACK_MANIFEST, ATTACK_MANIFEST_SHA256),
                (NPC_REPORT_UI_MANIFEST, NPC_REPORT_UI_MANIFEST_SHA256)]
    for path, digest in previous:
        check('NPC scout/rehearsal preserves every earlier manifest byte and mode: ' + path,
              entry(candidate, path) == entry(NPC_SCOUT_REHEARSAL_ADOPTION, path)
              == {'mode': '100644', 'sha256': digest})
    raw = (repository / NPC_SCOUT_REHEARSAL_MANIFEST).read_bytes()
    check('NPC scout/rehearsal manifest has its fixed digest and exact committed ordinary-file bytes',
          sha(raw) == NPC_SCOUT_REHEARSAL_MANIFEST_SHA256
          and entry(candidate, NPC_SCOUT_REHEARSAL_MANIFEST) == {'mode': '100644', 'sha256': NPC_SCOUT_REHEARSAL_MANIFEST_SHA256}
          and raw == git('show', candidate + ':' + NPC_SCOUT_REHEARSAL_MANIFEST))
    manifest = json.loads(raw)
    check('NPC scout/rehearsal pins cc19, all prior seals and the complete production and protected scopes',
          manifest.get('schema') == 'infinity-ring-protection-npc-scout-rehearsal-provenance-v1'
          and manifest.get('historicalBaselineSha') == BASELINE
          and manifest.get('previousAdoptionSourceSha') == NPC_SCOUT_REHEARSAL_ADOPTION
          and manifest.get('previousManifests') == [{'path': path, 'sha256': digest} for path, digest in previous]
          and manifest.get('productionPaths') == list(NPC_SCOUT_REHEARSAL_PRODUCTION_PATHS)
          and manifest.get('domainPaths') == list(DOMAIN_PATHS)
          and manifest.get('originalRingCriticalPaths') == list(RING_CRITICAL_PATHS)
          and manifest.get('exactDomainDeltaPaths') == list(NPC_SCOUT_REHEARSAL_DOMAIN_DELTAS)
          and manifest.get('exactRingCriticalDeltaPaths') == list(NPC_SCOUT_REHEARSAL_RING_DELTAS)
          and manifest.get('unchangedCombatEconomyPaths') == list(NPC_SCOUT_REHEARSAL_UNCHANGED_PATHS))
    delta = changed(NPC_SCOUT_REHEARSAL_ADOPTION, candidate, NPC_SCOUT_REHEARSAL_PRODUCTION_PATHS)
    check('complete production tree differs from cc19 only at the exact approved scout/rehearsal files',
          delta == list(NPC_SCOUT_REHEARSAL_CHANGED_PATHS))
    rows = []
    for path in delta:
        patch = source_delta_patch(git, NPC_SCOUT_REHEARSAL_ADOPTION, candidate, path)
        rows.append({'path': path, 'before': entry(NPC_SCOUT_REHEARSAL_ADOPTION, path),
                     'after': entry(candidate, path), 'patchSha256': sha(patch),
                     'hunks': source_delta_hunks(patch)})
    check('each scout/rehearsal mode, byte, full patch and hunk is exact and anchored in sealed cc19 bytes',
          manifest.get('changedPaths') == rows)
    check('NPC scout/rehearsal admits only exact domain deltas and preserves all ring, kernel and economy scopes',
          changed(NPC_SCOUT_REHEARSAL_ADOPTION, candidate, DOMAIN_PATHS) == list(NPC_SCOUT_REHEARSAL_DOMAIN_DELTAS)
          and changed(NPC_SCOUT_REHEARSAL_ADOPTION, candidate, RING_CRITICAL_PATHS) == list(NPC_SCOUT_REHEARSAL_RING_DELTAS)
          and changed(NPC_SCOUT_REHEARSAL_ADOPTION, candidate, NPC_SCOUT_REHEARSAL_UNCHANGED_PATHS) == [])
    return {'contract': 'exact-declared-npc-scout-rehearsal-semantic-delta',
            'historicalBaselineSha': BASELINE, 'historicalDomainByteIdentity': False,
            'previousAdoptionSourceSha': NPC_SCOUT_REHEARSAL_ADOPTION, 'candidateSourceSha': candidate,
            'historicalChangedPaths': changed(BASELINE, candidate, DOMAIN_PATHS),
            'previousProvenance': prior, 'manifestPath': NPC_SCOUT_REHEARSAL_MANIFEST,
            'manifestSha256': sha(raw), 'manifest': manifest,
            'verificationScope': 'Exact NPC scout/rehearsal source adoption only; not native or CI acceptance. Every historical protection, recovery, full-state and NPC native assertion remains required.'}


def npc_scout_comparison_provenance(repository, candidate, git, check):
    """Compose immutable e729 r14 bytes with only the exact comparison UI delta."""
    prior = npc_scout_rehearsal_provenance(repository, NPC_SCOUT_COMPARISON_ADOPTION, git, check)
    check('NPC scout comparison starts at the exact independently sealed e729 scout/rehearsal source',
          prior['contract'] == 'exact-declared-npc-scout-rehearsal-semantic-delta'
          and prior['candidateSourceSha'] == NPC_SCOUT_COMPARISON_ADOPTION)

    def changed(before, after, paths):
        return git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
                   before, after, '--', *paths).decode().splitlines()

    def entry(ref, path):
        value = git('ls-tree', ref, '--', path)
        if not value:
            return None
        mode, kind, oid = value.decode().split('\t')[0].split()
        if kind != 'blob':
            raise AssertionError('Declared NPC scout comparison path must be a file: ' + path)
        return {'mode': mode, 'sha256': sha(git('cat-file', 'blob', oid))}

    previous = [(DOMAIN_MANIFEST, DOMAIN_MANIFEST_SHA256), (IRN_MANIFEST, IRN_MANIFEST_SHA256),
                (DEMOLITION_MANIFEST, DEMOLITION_MANIFEST_SHA256), (NPC_MANIFEST, NPC_MANIFEST_SHA256),
                (ATTACK_MANIFEST, ATTACK_MANIFEST_SHA256),
                (NPC_REPORT_UI_MANIFEST, NPC_REPORT_UI_MANIFEST_SHA256),
                (NPC_SCOUT_REHEARSAL_MANIFEST, NPC_SCOUT_REHEARSAL_MANIFEST_SHA256)]
    for path, digest in previous:
        check('NPC scout comparison preserves every earlier manifest byte and mode: ' + path,
              entry(candidate, path) == entry(NPC_SCOUT_COMPARISON_ADOPTION, path)
              == {'mode': '100644', 'sha256': digest})
    raw = (repository / NPC_SCOUT_COMPARISON_MANIFEST).read_bytes()
    check('NPC scout comparison manifest has its fixed digest and exact committed ordinary-file bytes',
          sha(raw) == NPC_SCOUT_COMPARISON_MANIFEST_SHA256
          and entry(candidate, NPC_SCOUT_COMPARISON_MANIFEST) == {'mode': '100644', 'sha256': NPC_SCOUT_COMPARISON_MANIFEST_SHA256}
          and raw == git('show', candidate + ':' + NPC_SCOUT_COMPARISON_MANIFEST))
    manifest = json.loads(raw)
    check('NPC scout comparison pins e729, all seven prior seals and the complete production and protected scopes',
          manifest.get('schema') == 'infinity-ring-protection-npc-scout-comparison-provenance-v1'
          and manifest.get('historicalBaselineSha') == BASELINE
          and manifest.get('previousAdoptionSourceSha') == NPC_SCOUT_COMPARISON_ADOPTION
          and manifest.get('previousManifests') == [{'path': path, 'sha256': digest} for path, digest in previous]
          and manifest.get('productionPaths') == list(NPC_SCOUT_COMPARISON_PRODUCTION_PATHS)
          and manifest.get('domainPaths') == list(DOMAIN_PATHS)
          and manifest.get('originalRingCriticalPaths') == list(RING_CRITICAL_PATHS)
          and manifest.get('exactDomainDeltaPaths') == []
          and manifest.get('exactRingCriticalDeltaPaths') == []
          and manifest.get('unchangedPresentationPaths') == list(NPC_SCOUT_COMPARISON_UNCHANGED_PATHS))
    delta = changed(NPC_SCOUT_COMPARISON_ADOPTION, candidate, NPC_SCOUT_COMPARISON_PRODUCTION_PATHS)
    check('complete production tree differs from e729 only at the exact four scout comparison UI files',
          delta == list(NPC_SCOUT_COMPARISON_CHANGED_PATHS))
    rows = []
    for path in delta:
        patch = source_delta_patch(git, NPC_SCOUT_COMPARISON_ADOPTION, candidate, path)
        rows.append({'path': path, 'before': entry(NPC_SCOUT_COMPARISON_ADOPTION, path),
                     'after': entry(candidate, path), 'patchSha256': sha(patch),
                     'hunks': source_delta_hunks(patch)})
    check('each comparison UI mode, byte, full patch and hunk is exact and anchored in sealed e729 bytes',
          manifest.get('changedPaths') == rows)
    check('NPC scout comparison preserves entire domain, ring, original art and rehearsal panel scopes',
          changed(NPC_SCOUT_COMPARISON_ADOPTION, candidate, DOMAIN_PATHS) == []
          and changed(NPC_SCOUT_COMPARISON_ADOPTION, candidate, RING_CRITICAL_PATHS) == []
          and changed(NPC_SCOUT_COMPARISON_ADOPTION, candidate, NPC_SCOUT_COMPARISON_UNCHANGED_PATHS) == [])
    return {'contract': 'exact-declared-npc-scout-comparison-ui-delta',
            'historicalBaselineSha': BASELINE, 'historicalDomainByteIdentity': False,
            'previousAdoptionSourceSha': NPC_SCOUT_COMPARISON_ADOPTION, 'candidateSourceSha': candidate,
            'historicalChangedPaths': changed(BASELINE, candidate, DOMAIN_PATHS),
            'previousProvenance': prior, 'manifestPath': NPC_SCOUT_COMPARISON_MANIFEST,
            'manifestSha256': sha(raw), 'manifest': manifest,
            'verificationScope': 'Exact same-schema NPC scout comparison UI source adoption only; not native or CI acceptance. Every historical protection, recovery, full-state and NPC native assertion remains required.'}


def npc_rehearsal_formation_copy_provenance(repository, candidate, git, check):
    """Compose immutable be0 comparison bytes with only the exact formation-copy UI delta."""
    prior = npc_scout_comparison_provenance(repository, NPC_REHEARSAL_FORMATION_COPY_ADOPTION, git, check)
    check('NPC rehearsal formation copy starts at the exact independently sealed be0 comparison source',
          prior['contract'] == 'exact-declared-npc-scout-comparison-ui-delta'
          and prior['candidateSourceSha'] == NPC_REHEARSAL_FORMATION_COPY_ADOPTION)

    def changed(before, after, paths):
        return git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
                   before, after, '--', *paths).decode().splitlines()

    def entry(ref, path):
        value = git('ls-tree', ref, '--', path)
        if not value:
            return None
        mode, kind, oid = value.decode().split('\t')[0].split()
        if kind != 'blob':
            raise AssertionError('Declared NPC rehearsal formation copy path must be a file: ' + path)
        return {'mode': mode, 'sha256': sha(git('cat-file', 'blob', oid))}

    previous = [(DOMAIN_MANIFEST, DOMAIN_MANIFEST_SHA256), (IRN_MANIFEST, IRN_MANIFEST_SHA256),
                (DEMOLITION_MANIFEST, DEMOLITION_MANIFEST_SHA256), (NPC_MANIFEST, NPC_MANIFEST_SHA256),
                (ATTACK_MANIFEST, ATTACK_MANIFEST_SHA256),
                (NPC_REPORT_UI_MANIFEST, NPC_REPORT_UI_MANIFEST_SHA256),
                (NPC_SCOUT_REHEARSAL_MANIFEST, NPC_SCOUT_REHEARSAL_MANIFEST_SHA256),
                (NPC_SCOUT_COMPARISON_MANIFEST, NPC_SCOUT_COMPARISON_MANIFEST_SHA256)]
    for path, digest in previous:
        local = repository / path
        check('NPC rehearsal formation copy preserves every earlier manifest byte and mode: ' + path,
              local.is_file() and not local.is_symlink() and not (local.stat().st_mode & 0o111)
              and sha(local.read_bytes()) == digest
              and entry(candidate, path) == entry(NPC_REHEARSAL_FORMATION_COPY_ADOPTION, path)
              == {'mode': '100644', 'sha256': digest})
    local = repository / NPC_REHEARSAL_FORMATION_COPY_MANIFEST
    raw = local.read_bytes()
    check('NPC rehearsal formation copy manifest has its fixed digest and exact committed ordinary-file bytes',
          local.is_file() and not local.is_symlink() and not (local.stat().st_mode & 0o111)
          and sha(raw) == NPC_REHEARSAL_FORMATION_COPY_MANIFEST_SHA256
          and entry(candidate, NPC_REHEARSAL_FORMATION_COPY_MANIFEST) == {'mode': '100644', 'sha256': NPC_REHEARSAL_FORMATION_COPY_MANIFEST_SHA256}
          and raw == git('show', candidate + ':' + NPC_REHEARSAL_FORMATION_COPY_MANIFEST))
    manifest = json.loads(raw)
    check('NPC rehearsal formation copy pins be0, all eight prior seals and the complete production and protected scopes',
          manifest.get('schema') == 'infinity-ring-protection-npc-rehearsal-formation-copy-provenance-v1'
          and manifest.get('historicalBaselineSha') == BASELINE
          and manifest.get('previousAdoptionSourceSha') == NPC_REHEARSAL_FORMATION_COPY_ADOPTION
          and manifest.get('previousManifests') == [{'path': path, 'sha256': digest} for path, digest in previous]
          and manifest.get('productionPaths') == list(NPC_REHEARSAL_FORMATION_COPY_PRODUCTION_PATHS)
          and manifest.get('domainPaths') == list(DOMAIN_PATHS)
          and manifest.get('originalRingCriticalPaths') == list(RING_CRITICAL_PATHS)
          and manifest.get('exactDomainDeltaPaths') == []
          and manifest.get('exactRingCriticalDeltaPaths') == []
          and manifest.get('unchangedPresentationPaths') == list(NPC_REHEARSAL_FORMATION_COPY_UNCHANGED_PATHS))
    delta = changed(NPC_REHEARSAL_FORMATION_COPY_ADOPTION, candidate, NPC_REHEARSAL_FORMATION_COPY_PRODUCTION_PATHS)
    check('complete src/public tree differs from be0 only at the exact four formation-copy UI files',
          delta == list(NPC_REHEARSAL_FORMATION_COPY_CHANGED_PATHS))
    rows = []
    for path in delta:
        patch = source_delta_patch(git, NPC_REHEARSAL_FORMATION_COPY_ADOPTION, candidate, path)
        rows.append({'path': path, 'before': entry(NPC_REHEARSAL_FORMATION_COPY_ADOPTION, path),
                     'after': entry(candidate, path), 'patchSha256': sha(patch),
                     'hunks': source_delta_hunks(patch)})
    check('each formation-copy UI mode, byte, full patch and hunk is exact and anchored in sealed be0 bytes',
          manifest.get('changedPaths') == rows)
    check('NPC rehearsal formation copy preserves entire domain, ring, original art, report and comparison scopes',
          changed(NPC_REHEARSAL_FORMATION_COPY_ADOPTION, candidate, DOMAIN_PATHS) == []
          and changed(NPC_REHEARSAL_FORMATION_COPY_ADOPTION, candidate, RING_CRITICAL_PATHS) == []
          and changed(NPC_REHEARSAL_FORMATION_COPY_ADOPTION, candidate, NPC_REHEARSAL_FORMATION_COPY_UNCHANGED_PATHS) == [])
    return {'contract': 'exact-declared-npc-rehearsal-formation-copy-ui-delta',
            'historicalBaselineSha': BASELINE, 'historicalDomainByteIdentity': False,
            'previousAdoptionSourceSha': NPC_REHEARSAL_FORMATION_COPY_ADOPTION, 'candidateSourceSha': candidate,
            'historicalChangedPaths': changed(BASELINE, candidate, DOMAIN_PATHS),
            'previousProvenance': prior, 'manifestPath': NPC_REHEARSAL_FORMATION_COPY_MANIFEST,
            'manifestSha256': sha(raw), 'manifest': manifest,
            'verificationScope': 'Exact same-schema NPC rehearsal formation copy UI source adoption only; not native or CI acceptance. Every historical protection, recovery, full-state and NPC native assertion remains required.'}


def lab_blockers_provenance(repository, candidate, git, check):
    """Compose immutable c80 formation-copy bytes with only the exact laboratory-blockers UI delta."""
    check('Laboratory blockers integrates the exact c80 source ancestor',
          git('merge-base', LAB_BLOCKERS_ADOPTION, candidate).decode().strip() == LAB_BLOCKERS_ADOPTION)
    prior = npc_rehearsal_formation_copy_provenance(repository, LAB_BLOCKERS_ADOPTION, git, check)
    check('Laboratory blockers starts at the exact recursively verified c80 formation-copy source',
          prior['contract'] == 'exact-declared-npc-rehearsal-formation-copy-ui-delta'
          and prior['candidateSourceSha'] == LAB_BLOCKERS_ADOPTION)

    def changed(before, after, paths):
        return git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
                   before, after, '--', *paths).decode().splitlines()

    def entry(ref, path):
        value = git('ls-tree', ref, '--', path)
        if not value:
            return None
        mode, kind, oid = value.decode().split('\t')[0].split()
        if kind != 'blob':
            raise AssertionError('Declared Laboratory blockers path must be a file: ' + path)
        return {'mode': mode, 'sha256': sha(git('cat-file', 'blob', oid))}

    previous = [(DOMAIN_MANIFEST, DOMAIN_MANIFEST_SHA256), (IRN_MANIFEST, IRN_MANIFEST_SHA256),
                (DEMOLITION_MANIFEST, DEMOLITION_MANIFEST_SHA256), (NPC_MANIFEST, NPC_MANIFEST_SHA256),
                (ATTACK_MANIFEST, ATTACK_MANIFEST_SHA256),
                (NPC_REPORT_UI_MANIFEST, NPC_REPORT_UI_MANIFEST_SHA256),
                (NPC_SCOUT_REHEARSAL_MANIFEST, NPC_SCOUT_REHEARSAL_MANIFEST_SHA256),
                (NPC_SCOUT_COMPARISON_MANIFEST, NPC_SCOUT_COMPARISON_MANIFEST_SHA256),
                (NPC_REHEARSAL_FORMATION_COPY_MANIFEST, NPC_REHEARSAL_FORMATION_COPY_MANIFEST_SHA256)]
    for path, digest in previous:
        local = repository / path
        check('Laboratory blockers preserves every earlier manifest byte and mode: ' + path,
              local.is_file() and not local.is_symlink() and not (local.stat().st_mode & 0o111)
              and sha(local.read_bytes()) == digest
              and entry(candidate, path) == entry(LAB_BLOCKERS_ADOPTION, path)
              == {'mode': '100644', 'sha256': digest})
    local = repository / LAB_BLOCKERS_MANIFEST
    raw = local.read_bytes()
    check('Laboratory blockers manifest has its fixed digest and exact committed ordinary-file bytes',
          local.is_file() and not local.is_symlink() and not (local.stat().st_mode & 0o111)
          and sha(raw) == LAB_BLOCKERS_MANIFEST_SHA256
          and entry(candidate, LAB_BLOCKERS_MANIFEST) == {'mode': '100644', 'sha256': LAB_BLOCKERS_MANIFEST_SHA256}
          and raw == git('show', candidate + ':' + LAB_BLOCKERS_MANIFEST))
    manifest = json.loads(raw)
    check('Laboratory blockers pins c80, all nine prior seals and the complete production and protected scopes',
          manifest.get('schema') == 'infinity-ring-protection-lab-blockers-provenance-v1'
          and manifest.get('historicalBaselineSha') == BASELINE
          and manifest.get('previousAdoptionSourceSha') == LAB_BLOCKERS_ADOPTION
          and manifest.get('previousManifests') == [{'path': path, 'sha256': digest} for path, digest in previous]
          and manifest.get('productionPaths') == list(LAB_BLOCKERS_PRODUCTION_PATHS)
          and manifest.get('domainPaths') == list(DOMAIN_PATHS)
          and manifest.get('originalRingCriticalPaths') == list(RING_CRITICAL_PATHS)
          and manifest.get('exactDomainDeltaPaths') == []
          and manifest.get('exactRingCriticalDeltaPaths') == []
          and manifest.get('unchangedPresentationPaths') == list(LAB_BLOCKERS_UNCHANGED_PATHS))
    delta = changed(LAB_BLOCKERS_ADOPTION, candidate, LAB_BLOCKERS_PRODUCTION_PATHS)
    check('complete src/public tree differs from c80 only at the exact six laboratory-blockers UI files',
          delta == list(LAB_BLOCKERS_CHANGED_PATHS))
    rows = []
    for path in delta:
        patch = source_delta_patch(git, LAB_BLOCKERS_ADOPTION, candidate, path)
        rows.append({'path': path, 'before': entry(LAB_BLOCKERS_ADOPTION, path),
                     'after': entry(candidate, path), 'patchSha256': sha(patch),
                     'hunks': source_delta_hunks(patch)})
    check('Laboratory blockers source files are ordinary non-executable files',
          all(row['after'] is not None and row['after']['mode'] == '100644'
              and (row['before'] is None or row['before']['mode'] == '100644') for row in rows))
    check('each laboratory-blockers UI mode, byte, full patch and hunk is exact and anchored in sealed c80 bytes',
          manifest.get('changedPaths') == rows)
    baseline_rows = [row for row in rows if row['path'] in LAB_BLOCKERS_BASELINE_DELTAS]
    check('Original UI baseline bytes permit only the exact two complete laboratory presentation deltas',
          [row['path'] for row in baseline_rows] == list(LAB_BLOCKERS_BASELINE_DELTAS)
          and manifest.get('originalUiBaseline') == {'baseline': '69eca71',
              'expected': LAB_BLOCKERS_ORIGINAL_UI_HASHES, 'exactDeltaPaths': list(LAB_BLOCKERS_BASELINE_DELTAS),
              'changedPaths': baseline_rows}
          and all(row['before'] == {'mode': '100644', 'sha256': LAB_BLOCKERS_ORIGINAL_UI_HASHES[row['path']]}
                  and row['after']['mode'] == '100644' and row['hunks'] for row in baseline_rows))
    check('Laboratory blockers preserves entire domain, ring, original art, report and comparison scopes',
          changed(LAB_BLOCKERS_ADOPTION, candidate, DOMAIN_PATHS) == []
          and changed(LAB_BLOCKERS_ADOPTION, candidate, RING_CRITICAL_PATHS) == []
          and changed(LAB_BLOCKERS_ADOPTION, candidate, LAB_BLOCKERS_UNCHANGED_PATHS) == [])
    return {'contract': 'exact-declared-lab-blockers-ui-delta',
            'historicalBaselineSha': BASELINE, 'historicalDomainByteIdentity': False,
            'previousAdoptionSourceSha': LAB_BLOCKERS_ADOPTION, 'candidateSourceSha': candidate,
            'historicalChangedPaths': changed(BASELINE, candidate, DOMAIN_PATHS),
            'previousProvenance': prior, 'manifestPath': LAB_BLOCKERS_MANIFEST,
            'manifestSha256': sha(raw), 'manifest': manifest,
            'verificationScope': 'Exact same-schema Laboratory blockers UI source adoption only; not native or CI acceptance. Every historical protection, recovery, full-state and NPC native assertion remains required.'}


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
    marker = '--ring-protection-owner=' + uuid.uuid4().hex
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
    passed = result.get('completed') and result.get('result') == RESULTS[args.expect]
    print(json.dumps({'completed': bool(passed), 'result': result.get('result'),
                      'checks': len(result.get('checks', [])), 'report': str(report_path)}, ensure_ascii=False))
    return 0 if passed else 1


INIT = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const key=__KEY__,epoch=__EPOCH__,get=Storage.prototype.getItem,set=Storage.prototype.setItem;
 const native=fn=>/\[native code\]/.test(Function.prototype.toString.call(fn));
 const integrity={storage:localStorage instanceof Storage,get:native(get),set:native(set),
  fileText:native(File.prototype.text),confirm:native(window.confirm)};
 let elapsed=0,next=0;const callbacks=new Map(),intervals=new Map();
 Date.now=()=>epoch+elapsed;Object.defineProperty(performance,'now',{value:()=>elapsed});
 window.requestAnimationFrame=fn=>{const id=++next;callbacks.set(id,fn);return id;};
 window.cancelAnimationFrame=id=>callbacks.delete(id);
 window.setInterval=(fn,ms,...args)=>{const id=++next;intervals.set(id,{fn,ms,args});return id;};
 window.clearInterval=id=>intervals.delete(id);
 const p={events:[],files:[],observed:[],handlerObserved:[],replay:null,fault:null,faultWritten:false,readFaults:0,integrity,
  raw:()=>get.call(localStorage,key),
  storage:()=>Object.keys(localStorage).filter(k=>k===key||k.startsWith(key+'.backup')).sort().map(k=>({key:k,raw:get.call(localStorage,k)})),
  clock:()=>({epoch,elapsed,dateNow:Date.now(),performanceNow:performance.now()}),
  advance:ms=>{if(!Number.isInteger(ms)||ms<0||ms>3000)throw Error('Bounded controlled clock only');elapsed+=ms;},
  frame:()=>{const due=[...callbacks.values()];callbacks.clear();for(const fn of due)fn(elapsed);return due.length;},
  autosave:()=>{const due=[...intervals.values()].filter(x=>x.ms===15000);for(const x of due)x.fn(...x.args);return due.length;},
  inject:kind=>{p.fault=kind;p.faultWritten=false;p.readFaults=0;}
 };
 window.__ringProtection=p;
 const watched=k=>k===key||k.startsWith(key+'.backup');
 Storage.prototype.getItem=function(k){
  k=String(k);
  if(this===localStorage&&k===key&&p.fault==='readback-throw'&&p.faultWritten&&p.readFaults===0){
   p.readFaults++;p.events.push({operation:'read-throw',key:k,injected:true,at:elapsed});
   throw new DOMException('Labeled post-write readback refusal','SecurityError');
  }
  const value=get.call(this,k);
  if(this===localStorage&&watched(k))p.events.push({operation:'read',key:k,value,at:elapsed});
  return value;
 };
 Storage.prototype.setItem=function(k,v){
  k=String(k);v=String(v);
  if(this!==localStorage||!watched(k))return set.call(this,k,v);
  p.events.push({operation:'write-attempt',key:k,value:v,before:get.call(this,k),at:elapsed});
  if(k===key&&p.fault==='write-throw'){
   p.events.push({operation:'write-throw',key:k,injected:true,at:elapsed});
   throw new DOMException('Labeled targeted current-slot write failure','QuotaExceededError');
  }
  set.call(this,k,v);
  if(k===key)p.faultWritten=true;
  p.events.push({operation:'write-return',key:k,value:v,actual:get.call(this,k),at:elapsed});
 };
 window.addEventListener('storage',event=>{
  if(event.storageArea===localStorage&&event.key===key)p.events.push({operation:'storage-event',
   key:event.key,trusted:event.isTrusted,oldValue:event.oldValue,newValue:event.newValue,url:event.url,at:elapsed});
 });
 for(const type of ['click','input','change','keydown'])document.addEventListener(type,event=>{
  const target=event.target.closest?.('button,input,select');
  if(target)p.events.push({operation:'ui-'+type,trusted:event.isTrusted,id:target.id,
   action:target.dataset.action??null,ring:target.dataset.ring??null,bind:target.dataset.bind??null,replay:p.replay,at:elapsed});
  if(type==='change'&&target?.matches('[data-bind="import-file"]')){
   const file=target.files[0],row={name:file?.name,size:file?.size,trusted:event.isTrusted,
    beforeRaw:get.call(localStorage,key),text:null,error:null};p.files.push(row);
   if(file)file.text().then(text=>row.text=text,error=>row.error=String(error));
  }
 },true);
})();'''


def worker(args):
    from playwright.sync_api import sync_playwright, expect
    out = Path(args.output).resolve()
    started = time.monotonic()
    parsed = urlparse(args.url)
    origin = f'{parsed.scheme}://{parsed.netloc}'
    repository = Path(__file__).resolve().parent.parent
    report = {'schema': 'infinity-ring-protection-browser-v1', 'completed': False,
              'result': 'running', 'expectation': args.expect, 'expectedSourceSha': args.expected_sha,
              'productionBaselineSha': BASELINE, 'url': args.url,
              'classification': 'known limitation reproduction; not a UI safety/correctness pass',
              'clockMode': 'controlled Date/performance/RAF/autosave callbacks, actual HTTP and native Storage',
              'liveStateObservation': 'Read-only CDP conditional breakpoint at original application frame; calls unchanged pure serializeState, records actual SaveSession mode and original bytes; never assigns any production state.',
              'checks': [], 'stages': [], 'sources': [], 'scriptAssets': [], 'errors': [], 'failedRequests': [],
              'runtime': {'python': platform.python_version(), 'platform': platform.platform()},
              'limitations': ['Write/readback failures are explicitly injected, not natural quota exhaustion.',
                             'Desktop Chromium only; no background-throttling or physical mobile claim.',
                             'Enabled protected controls are a reproduced UI defect; rejected actions and frozen state do not fix that defect.',
                             'Top-up is an explicitly ready-disabled insufficient-funds control in these natural saves; this run does not reproduce a top-up misleading-enabled defect.']}
    case, active, browser, release, source, key = 'provenance', None, None, None, None, None
    milestones = {}
    synchronized = args.expect == 'synchronized-controls'
    if synchronized:
        report['classification'] = 'bounded synchronized ring controls and recovery acceptance; source-domain provenance verified separately from native behavior'
        report['liveStateObservation'] += ' A second read-only breakpoint observes real original guarded-handler entry; it never invokes the handler.'
        report['limitations'][2] = 'Synthetic stale-enabled dispatch is adversarial handler coverage, never trusted/native user input.'
        report['limitations'].append('Synthetic document visibility plus stopped controlled RAF exercises immediate DOM retirement; not native operating-system background throttling.')

    def flush():
        report.update(activeCase=case, elapsedHostSeconds=round(time.monotonic()-started, 3))
        atomic_json(out / REPORT_NAME, report)

    def check(name, condition, detail=None):
        row = {'case': case, 'name': name, 'passed': bool(condition)}
        if detail is not None:
            row['detail'] = detail
        report['checks'].append(row)
        flush()
        if not condition:
            raise AssertionError(f'{case}: {name}')

    def dump(name, value):
        data = value.encode() if isinstance(value, str) else value
        (out / name).write_bytes(data)
        return {'file': name, 'bytes': len(data), 'sha256': sha(data)}

    def dump_json(name, value):
        return dump(name, json.dumps(value, ensure_ascii=False, indent=2)+'\n')

    def git(*arguments):
        return subprocess.check_output(['git', *arguments], cwd=repository, stderr=subprocess.PIPE, timeout=10)

    def clean_status(value):
        if not isinstance(value, str):
            return False
        for line in value.splitlines():
            if not line.startswith('?? '):
                return False
            path = Path(line[3:])
            if (line[3:].startswith(('"', '/')) or '..' in path.parts or not path.parts
                or path.parts[0] in {'src', 'public', 'scripts', '.github', '.agents', '.codex'}
                or path.suffix.lower() not in {'.json', '.jsonl', '.log', '.txt', '.png', '.jpg', '.webp', '.zip'}
                or path.name in {'package.json', 'package-lock.json', 'tsconfig.json', 'vercel.json'}
                or path.name.startswith(('.env', 'tsconfig.', 'vite.config.', 'vitest.config.'))):
                return False
        return True

    def processes():
        client = browser.new_browser_cdp_session()
        try:
            identities = [process_identity(int(row['id'])) for row in client.send('SystemInfo.getProcessInfo')['processInfo']]
            path = out / 'chromium-processes.json'
            prior = json.loads(path.read_text()) if path.exists() else []
            rows = {(row['pid'], row['startTimeTicks']): row for row in prior + [x for x in identities if x]}
            atomic_json(path, list(rows.values()))
        finally:
            client.detach()

    class Page:
        def __init__(self, context, stage, label):
            self.stage, self.label = stage, label
            self.page = context.new_page()
            self.page.set_default_timeout(7000)
            self.page.set_default_navigation_timeout(15000)
            self.responses, self.executed = [], []
            self.page.on('response', lambda r: self.responses.append(r) if r.request.resource_type == 'script' else None)
            self.page.on('pageerror', lambda e: report['errors'].append({'case': case, 'page': label, 'error': str(e)}))
            self.page.on('requestfailed', lambda r: report['failedRequests'].append({'case': case, 'page': label, 'url': r.url, 'failure': r.failure}))
            self.cdp = context.new_cdp_session(self.page)
            self.cdp.send('Network.enable')
            self.cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
            self.cdp.on('Debugger.scriptParsed', lambda e: self.executed.append(e) if e.get('url', '').startswith(('http://', 'https://')) else None)
            self.cdp.send('Debugger.enable')
            response = self.page.goto(args.url, wait_until='networkidle')
            check('actual HTTP 200 production navigation', response is not None and response.status == 200 and response.url == args.url)
            self.page.locator('[data-bind="amount-metal"]').wait_for()
            check('captured Storage backing and unchanged native File.text/confirm are real', all(self.page.evaluate('window.__ringProtection.integrity').values()))
            self.verify_assets_and_observer()
            self.frame()

        def verify_assets_and_observer(self):
            installed = 0
            for event in self.executed:
                url = event['url']
                relative = unquote(urlparse(url).path).removeprefix(unquote(parsed.path))
                check('executed HTTP script belongs to pinned release', urlparse(url).scheme == parsed.scheme and urlparse(url).netloc == parsed.netloc and relative in release['files'] and relative.endswith('.js'), url)
                matches = [r for r in self.responses if r.url == url and r.status == 200]
                check('V8-executed source has its real HTTP 200 response', bool(matches), url)
                body = matches[-1].body()
                text = self.cdp.send('Debugger.getScriptSource', {'scriptId': event['scriptId']})['scriptSource']
                row = {'case': case, 'page': self.label, 'url': url, 'releaseFile': relative,
                       'httpSha256': sha(body), 'executedSourceSha256': sha(text),
                       'releaseSha256': release['files'][relative], 'bytes': len(body)}
                report['scriptAssets'].append(row)
                check('complete HTTP bytes and actual executed JS match pinned release hash', sha(body) == sha(text) == release['files'][relative], row)
                anchors = production_action_handlers(text)
                row['observerHandlerCandidates'] = len(anchors)
                if not anchors:
                    continue
                check('exactly one original guarded action handler exists', len(anchors) == 1)
                anchor = anchors[0]
                session = anchor.group(3)
                body_after = text[anchor.end():anchor.end()+700]
                state_matches = list(re.finditer(r'const [\w$]+=([\w$]+),[\w$]+=\1\.unlocked;', body_after))
                serializers = production_serializers(text)
                frames = list(re.finditer(r'window\.requestAnimationFrame\(([\w$]+)\);window\.setInterval', text))
                check('state, pure production serializer and original frame resolve uniquely',
                      len(state_matches) == len(serializers) == len(frames) == 1,
                      {'stateMatches': len(state_matches), 'serializerMatches': len(serializers),
                       'frameMatches': len(frames), 'serializerNames': [m.group('name') for m in serializers]})
                state, serializer, frame = state_matches[0].group(1), serializers[0].group('name'), frames[0].group(1)
                declaration = re.search(r'function '+re.escape(frame)+r'\([\w$]+\)\{', text)
                check('original application RAF declaration exists', declaration is not None)
                position = declaration.end()
                line = text.count('\n', 0, position)
                column = position-(text.rfind('\n', 0, position)+1)
                expression = f'globalThis.__ringProtection.observed.push(JSON.stringify({{state:{serializer}({state}),mode:{session}.mode,notice:{session}.notice,message:{session}.message,expectedRaw:{session}.expectedRaw,protectedRaw:{session}.protectedRaw}})),false'
                location = self.cdp.send('Debugger.setBreakpointByUrl', {'url': url, 'lineNumber': line, 'columnNumber': column, 'condition': expression})
                check('read-only live-state observer bound to actual original frame', len(location.get('locations', [])) == 1, location)
                self.stage.setdefault('observerBindings', []).append({'page': self.label, 'url': url, 'location': location, 'expression': expression})
                if synchronized:
                    # Observe, never invoke or replace, the original guarded handler.
                    handler_position = text.index('{', anchor.start()) + 1
                    handler_line = text.count('\n', 0, handler_position)
                    handler_column = handler_position - (text.rfind('\n', 0, handler_position) + 1)
                    handler_expression = f'globalThis.__ringProtection.handlerObserved.push(JSON.stringify({{action:{anchor.group(2)},mode:{session}.mode}})),false'
                    binding = self.cdp.send('Debugger.setBreakpointByUrl', {'url': url, 'lineNumber': handler_line, 'columnNumber': handler_column, 'condition': handler_expression})
                    check('read-only original action-handler observation resolves once', len(binding.get('locations', [])) == 1, binding)
                    self.stage.setdefault('observerBindings', []).append({'page': self.label, 'url': url, 'location': binding, 'expression': handler_expression})
                installed += 1
            check('one complete verified application asset supplies observation', installed == 1)

        def frame(self, milliseconds=0):
            before = self.page.evaluate('window.__ringProtection.observed.length')
            if milliseconds:
                self.page.evaluate('n=>window.__ringProtection.advance(n)', milliseconds)
            count = self.page.evaluate('window.__ringProtection.frame()')
            observed = self.page.evaluate('window.__ringProtection.observed.slice(-1)[0]')
            check('controlled wave runs the original frame with a fresh complete-state observation', count >= 1 and self.page.evaluate('window.__ringProtection.observed.length') == before+1 and observed is not None)
            return json.loads(observed)

        def click(self, selector, run_frame=True):
            locator = self.page.locator(selector)
            check('native pointer target is visible and enabled: '+selector, locator.is_visible() and locator.is_enabled())
            hit = locator.evaluate('''e=>{e.scrollIntoView({block:'center',inline:'center',behavior:'instant'});const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return h===e||e.contains(h);}''')
            check('native pointer target is unobscured: '+selector, hit)
            locator.click(force=True)
            if run_frame:
                self.frame()

        def tab(self, name):
            check('no unintended offline catch-up modal', not self.page.locator('[data-bind="offline-modal"]').is_visible())
            self.click(f'[data-tab="{name}"]')
            check('requested original tab is visible', self.page.locator(f'[data-tab-panel="{name}"]').is_visible())

        def type(self, selector, value):
            self.click(selector)
            self.page.keyboard.press('ControlOrMeta+A')
            self.page.keyboard.type(str(value))
            self.page.keyboard.press('Tab')
            self.frame()
            check('trusted keyboard enters actual draft value', self.page.locator(selector).input_value() == str(value))

        def raw(self):
            return self.page.evaluate('window.__ringProtection.raw()')

        def storage(self):
            return self.page.evaluate('window.__ringProtection.storage()')

        def import_source(self, alias):
            self.tab('save')
            self.click('[data-action="save"]')
            before = self.raw()
            current = json.loads(before)['state']
            planet = next(p for p in current['planets'] if p['id'] == current['activePlanetId'])
            incoming = milestones[alias]['save']
            required = [f'已读取存档 v{incoming["version"]}/r{incoming["revision"]}。', f'第 {current["stats"]["launches"]+1} 轮',
                        f'{len(current["planets"])} 颗星球', f'当前“{planet["name"]}”',
                        '读取期间产生的变化也会被替换', '保留当前已保存原件', '写入校验成功后才采用']
            dialogs = []
            def answer(dialog):
                valid = dialog.type == 'confirm' and all(x in dialog.message for x in required)
                dialogs.append({'page': self.label, 'type': dialog.type, 'message': dialog.message, 'accepted': valid})
                dialog.accept() if valid else dialog.dismiss()
            self.page.once('dialog', answer)
            index = self.page.evaluate('window.__ringProtection.files.length')
            path = out / milestones[alias]['evidence']['file']
            self.page.locator('[data-bind="import-file"]').set_input_files(str(path))
            expect(self.page.locator('[data-bind="status"]')).to_contain_text('已导入并存入本地')
            self.page.wait_for_function('(i)=>!!window.__ringProtection.files[i] && window.__ringProtection.files[i].text!==null', arg=index)
            row = self.page.evaluate('(i)=>window.__ringProtection.files[i]', index)
            check('one native confirmation identifies source and exact replacement consequences', len(dialogs) == 1 and dialogs[0]['accepted'], dialogs)
            check('real selected File native text exactly equals immutable natural source', row['trusted'] and row['text'] == path.read_text() and row['size'] == path.stat().st_size and row['beforeRaw'] == before and row['error'] is None)
            check('native import backs up the complete previous current bytes', any(x['raw'] == before and x['key'] != key for x in self.storage()))
            observed = self.frame()
            check('import adopts the complete exact natural state only after persistence', observed['mode'] == 'ready' and observed['state'] == incoming['state'] == json.loads(self.raw())['state'])
            self.stage.setdefault('imports', []).append({'page': self.label, 'source': alias, 'dialogs': dialogs,
                'selectedFile': dump_json(f'{case}-{self.label}-selected-file.json', row),
                'before': dump(f'{case}-{self.label}-before-import.json', before),
                'adopted': dump(f'{case}-{self.label}-adopted.json', self.raw())})
            self.tab('arcade')

        def snapshot(self, label):
            observed = self.frame()
            controls = {name: self.page.locator(selector).evaluate('''e=>({disabled:e.disabled,visible:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length),value:e.value??null,text:e.textContent,title:e.title,html:e.outerHTML})''') for name, selector in CONTROLS.items()}
            observed.update(controls=controls, ringDom=self.ring_dom() if synchronized else None, storage=self.storage(), clock=self.page.evaluate('window.__ringProtection.clock()'),
                            status=self.page.locator('[data-bind="status"]').inner_text(),
                            visibleNotice=self.page.locator('[data-bind="notice"]').is_visible(),
                            noticeText=self.page.locator('[data-bind="notice-text"]').inner_text())
            evidence = dump_json(f'{case}-{self.label}-{label}.json', observed)
            dom = dump_json(f'{case}-{self.label}-{label}-dom.json', {'html': self.page.content()})
            self.stage.setdefault('snapshots', []).append({'page': self.label, 'label': label, 'fullStateAndStorage': evidence, 'dom': dom})
            return observed

        def ring_dom(self):
            return self.page.evaluate('''selector=>{
              const node=document.querySelector('#ring-protection');
              return {mutators:[...document.querySelectorAll(selector)].map(e=>({id:e.id,action:e.dataset.action??null,ring:e.dataset.ring??null,symbol:e.dataset.symbol??null,delta:e.dataset.delta??null,disabled:e.disabled,value:e.value??null,visible:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)})),
                protection:node?{text:node.textContent,hidden:node.hidden,outsideAuto:!node.closest('.ring-auto'),visible:!!(node.offsetWidth||node.offsetHeight||node.getClientRects().length)}:null,
                autoStatus:document.querySelector('#ring-auto-status')?.textContent??null};
            }''', MUTATORS)

        def assert_locked(self, dom, message=None):
            check('all 17 ring mutators including eight bet buttons are disabled', len(dom['mutators']) == 17 and all(e['disabled'] for e in dom['mutators']), dom)
            bets = {(e['symbol'], e['delta']) for e in dom['mutators'] if e['action'] == 'arcade-bet'}
            check('disabled bet coverage includes every original symbol and direction', bets == {(symbol, delta) for symbol in ('metal', 'crystal', 'deuterium', 'drifter') for delta in ('-1', '1')})
            protection = dom['protection']
            check('ring protection cause is populated outside the conditional automatic panel', protection is not None and not protection['hidden'] and protection['outsideAuto'] and bool(protection['text']))
            if message is not None:
                check('ring protection text is the unabridged SaveSession failure cause', protection['text'] == message, protection)

        def assert_ready_notice(self, dom):
            check('ready world clears and hides the ring protection cause', dom['protection'] is not None and dom['protection']['hidden'] and dom['protection']['text'] == '')

        def assert_frozen(self, value, baseline, mode, label):
            check('whole live state and every native current/backup byte remain frozen: '+label,
                  value['state'] == baseline['state'] and value['storage'] == baseline['storage'] and value['mode'] == mode)
            check('original expected/protected bytes remain exact: '+label, value['protectedRaw'] == baseline['protectedRaw'] and value['expectedRaw'] == baseline['expectedRaw'])
            self.assert_locked(value['ringDom'], value['message'])

        def verify_fixed_controls(self, baseline, mode):
            self.export_original(baseline['protectedRaw'], 'before-actions')
            # Read-only inspection uses real enabled controls and native input.
            self.click('#ring-odds-source')
            self.page.keyboard.press('Home')
            self.page.keyboard.press('ArrowDown')
            self.page.keyboard.press('Tab')
            self.frame()
            check('protected odds source remains selectable by native keyboard', self.page.locator('#ring-odds-source').input_value() == 'charge-1')
            self.click('[data-tile="0"]')
            check('protected tile inspection displays the selected source', '充能 1 段' in self.page.locator('#ring-tile-info').inner_text())
            history = self.page.locator('[data-ring-history]').first
            check('natural source has inspectable protected history', history.count() == 1 and history.is_visible())
            history.click(force=True)
            self.frame()
            check('history details remain readable while protected', self.page.locator('.ring-history-detail').is_visible() and bool(self.page.locator('#ring-history-lines').inner_text()))
            self.click('[data-ring="close-history"]')
            self.tab('save')
            for selector in ('[data-action="save"]', '[data-action="export"]', '[data-action="import-text"]', '[data-action="reset"]', '[data-bind="import-file"]'):
                check('recovery/export control remains enabled: '+selector, self.page.locator(selector).is_enabled())
            self.tab('arcade')
            self.assert_frozen(self.snapshot('after-read-only-views'), baseline, mode, 'odds/history/recovery views')
            self.page.evaluate('window.__ringProtection.events.length=0')
            native_attempts = []
            for name, selector in CONTROLS.items():
                target = self.page.locator(selector)
                check('ordinary disabled target is visible: '+name, target.is_visible() and target.is_disabled())
                before_handlers = self.page.evaluate('window.__ringProtection.handlerObserved.length')
                before_events = len(self.audit())
                before_value = target.evaluate('e=>e.value??null')
                geometry = target.evaluate('''e=>{document.activeElement?.blur();e.scrollIntoView({block:'center',inline:'center',behavior:'instant'});const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {x:r.x+r.width/2,y:r.y+r.height/2,hit:h===e||e.contains(h)};}''')
                check('disabled target receives an unobscured native pointer attempt: '+name, geometry['hit'])
                self.page.mouse.click(geometry['x'], geometry['y'])
                focused = target.evaluate('e=>{e.focus();return document.activeElement===e;}')
                self.page.keyboard.press('Enter')
                self.page.keyboard.press('Space')
                if name in ('slot', 'count', 'cap'):
                    self.page.keyboard.press('ArrowUp')
                after = self.snapshot('native-disabled-'+name)
                attempt_events = self.audit()[before_events:]
                check('native disabled pointer/keyboard attempts cannot focus, edit or invoke an action: '+name,
                      not focused and target.evaluate('e=>e.value??null') == before_value
                      and self.page.evaluate('window.__ringProtection.handlerObserved.length') == before_handlers
                      and not any(e['operation'] in ('ui-click', 'ui-input', 'ui-change') for e in attempt_events))
                self.assert_frozen(after, baseline, mode, 'native disabled '+name)
                native_attempts.append({'control': name, 'pointer': 'Playwright mouse, native browser input', 'keyboard': ['Enter', 'Space'] + (['ArrowUp'] if name in ('slot', 'count', 'cap') else []), 'disabledFocusRejected': not focused, 'events': attempt_events})
            self.stage['nativeDisabledAttempts'] = dump_json(case+'-native-disabled-attempts.json', native_attempts)
            adversarial = []
            for name in ('manual-run', 'manual-all', 'bet-plus', 'bet-minus', 'clear', 'topup', 'auto-arm', 'auto-stop'):
                before_handlers = self.page.evaluate('window.__ringProtection.handlerObserved.length')
                before_events = len(self.audit())
                # Deliberately forge only presentation capability. This is not
                # trusted browser input and never creates or assigns game state.
                self.page.locator(CONTROLS[name]).evaluate('''e=>{
                  const p=window.__ringProtection,disabled=e.disabled;p.replay='stale-enabled';
                  try {e.disabled=false;e.click();}
                  finally {e.disabled=disabled;p.replay=null;}
                }''')
                after = self.snapshot('adversarial-'+name)
                rows = self.audit()[before_events:]
                handlers = self.page.evaluate('(n)=>window.__ringProtection.handlerObserved.slice(n).map(JSON.parse)', before_handlers)
                check('stale-enabled replay is explicitly synthetic, never trusted: '+name,
                      any(e['operation'] == 'ui-click' and not e['trusted'] and e.get('replay') == 'stale-enabled' for e in rows))
                if not name.startswith('auto-'):
                    expected_action = 'arcade-bet' if name.startswith('bet-') else 'arcade-bet-clear' if name == 'clear' else 'arcade-topup' if name == 'topup' else 'arcade-'+name.removeprefix('manual-')
                    check('original main guard actually receives the adversarial arcade action: '+name,
                          len(handlers) == 1 and handlers[0]['mode'] == mode and handlers[0]['action']['type'] == expected_action, handlers)
                else:
                    check('automatic local writable guard rejects stale-enabled replay before main dispatch: '+name, handlers == [], handlers)
                self.assert_frozen(after, baseline, mode, 'adversarial '+name)
                check('adversarial replay attempts no storage writes: '+name, not any(e['operation'].startswith('write-') for e in rows))
                adversarial.append({'control': name, 'label': 'adversarial synthetic stale-enabled replay', 'events': rows, 'originalMainHandlerObservations': handlers})
            self.stage['adversarialReplay'] = dump_json(case+'-adversarial-replay.json', adversarial)
            for name in ('slot', 'count', 'cap'):
                self.page.locator(CONTROLS[name]).evaluate('''e=>{
                  const p=window.__ringProtection,value=e.value;p.replay='draft-input-change';
                  try {if(e.tagName==='SELECT')e.selectedIndex=0;else e.value='2';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}
                  finally {e.value=value;p.replay=null;}
                }''')
                self.assert_frozen(self.snapshot('adversarial-draft-'+name), baseline, mode, 'synthetic draft input/change '+name)
            self.tab('save')
            self.tab('arcade')
            self.assert_frozen(self.snapshot('after-renderer-and-tab-revisit'), baseline, mode, 'original renderer and tab revisit')
            self.frame(3000)
            check('actual protected autosave callback is present', self.page.evaluate('window.__ringProtection.autosave()') == 1)
            self.assert_frozen(self.snapshot('after-tick-autosave'), baseline, mode, '3-second frame and autosave')
            check('all native, adversarial, draft, renderer and tick probes attempt zero save writes', not any(e['operation'].startswith('write-') for e in self.audit()))
            self.stage['blockedActionAudit'] = dump_json(case+'-blocked-actions-native-and-labeled-synthetic-audit.json', self.audit())

        def verify_protected_viewports(self, baseline, mode):
            original_clock = self.page.evaluate('window.__ringProtection.clock()')
            # Reuse the natural-ring witness: actual header geometry, native
            # scrolling and hit testing, without changing layout or game state.
            visibility_probe = r'''position=>{
              const e=document.querySelector('#ring-protection');
              const header=()=>{
                const bar=document.querySelector('.topbar'),r=bar?.getBoundingClientRect();
                const position=bar?getComputedStyle(bar).position:null;
                return {position,top:r?.top??0,bottom:r?.bottom??0,
                  obstruction:r&&['sticky','fixed'].includes(position)&&r.top<innerHeight&&r.bottom>0?Math.min(innerHeight,r.bottom):0};
              };
              const r=e.getBoundingClientRect(),before=header();
              if(position&&(r.top<before.obstruction+8||r.bottom>innerHeight-8)){
                const desired=before.obstruction+8+Math.max(0,(innerHeight-before.obstruction-16-r.height)/2);
                window.scrollBy({top:r.top-desired,left:0,behavior:'instant'});
              }
              const bounds=e.getBoundingClientRect(),bar=header();
              const points=[[.1,.1],[.9,.1],[.5,.5],[.1,.9],[.9,.9]].map(([u,v])=>{
                const x=bounds.left+bounds.width*u,y=bounds.top+bounds.height*v,hit=document.elementFromPoint(x,y);
                return {x,y,unoccluded:hit!==null&&(hit===e||e.contains(hit)),
                  hit:hit?{tag:hit.tagName,id:hit.id,className:hit.getAttribute('class')}:null};
              });
              return {scrollX,scrollY,header:bar,
                bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},points,
                unoccluded:bounds.width>0&&bounds.height>0&&bounds.left>=0&&bounds.right<=innerWidth
                  &&bounds.top>=bar.obstruction&&bounds.bottom<=innerHeight&&points.every(p=>p.unoccluded)};
            }'''
            for width in (320, 390, 768, 1440):
                self.page.set_viewport_size({'width': width, 'height': 1000})
                self.page.locator('#ring-protection').evaluate("e=>e.scrollIntoView({block:'center',inline:'center',behavior:'instant'})")
                after = self.snapshot('protected-viewport-'+str(width))
                self.assert_frozen(after, baseline, mode, 'responsive viewport '+str(width))
                check('responsive reflow advances no controlled simulation time: '+str(width), after['clock'] == original_clock)
                visible_before = self.page.evaluate(visibility_probe, True)
                check('protection cause clears the actual header and hit-tests unobscured before capture: '+str(width), visible_before['unoccluded'], visible_before)
                layout = self.page.evaluate("""()=>{
                  const e=document.querySelector('#ring-protection'),r=e.getBoundingClientRect();
                  return {innerWidth:window.innerWidth,innerHeight:window.innerHeight,
                    documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,
                    cause:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
                }""")
                check('protected viewport has no horizontal page overflow: '+str(width),
                      layout['innerWidth'] == width and max(layout['documentWidth'], layout['bodyWidth']) <= width+1, layout)
                cause = layout['cause']
                check('unchanged raw protection cause is visible within the responsive viewport: '+str(width),
                      after['ringDom']['protection']['visible'] and after['ringDom']['protection']['text'] == baseline['message']
                      and cause['width'] > 0 and cause['height'] > 0 and cause['left'] >= -1 and cause['right'] <= width+1
                      and cause['top'] >= -1 and cause['bottom'] <= layout['innerHeight']+1, layout)
                path = out / (case+'-protected-'+str(width)+'.png')
                self.page.screenshot(path=str(path), full_page=False, timeout=7000)
                visible_after = self.page.evaluate(visibility_probe, False)
                check('protection cause remains unobscured after capture without further scrolling: '+str(width), visible_after['unoccluded'], visible_after)
                check('responsive capture advances no controlled simulation time: '+str(width), self.page.evaluate('window.__ringProtection.clock()') == original_clock)
                self.stage.setdefault('responsiveProtection', []).append({
                    'viewport': {'width': width, 'height': 1000},
                    'label': 'desktop Chromium viewport reflow, zero controlled simulation advance; not a physical device or native background test',
                    'layout': layout, 'clock': after['clock'], 'visibilityBefore': visible_before, 'visibilityAfter': visible_after,
                    'screenshot': {'file': path.name, 'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size}})

        def replace_natural(self, alias, outcome):
            self.tab('save')
            before = self.snapshot('recovery-'+alias+'-'+outcome+'-before')
            raw_before = self.raw()
            planet = next(p for p in before['state']['planets'] if p['id'] == before['state']['activePlanetId'])
            incoming = milestones[alias]['save']
            required = [f'已读取存档 v{incoming["version"]}/r{incoming["revision"]}。',
                        f'第 {before["state"]["stats"]["launches"]+1} 轮', f'{len(before["state"]["planets"])} 颗星球',
                        f'当前“{planet["name"]}”', '读取期间产生的变化也会被替换', '保留当前已保存原件', '写入校验成功后才采用']
            dialogs = []
            def answer(dialog):
                valid = dialog.type == 'confirm' and all(value in dialog.message for value in required)
                accepted = valid and outcome != 'cancelled'
                dialogs.append({'type': dialog.type, 'message': dialog.message, 'valid': valid, 'accepted': accepted})
                dialog.accept() if accepted else dialog.dismiss()
            self.page.once('dialog', answer)
            file_index = self.page.evaluate('window.__ringProtection.files.length')
            event_index = len(self.audit())
            path = out / milestones[alias]['evidence']['file']
            self.page.locator('[data-bind="import-file"]').set_input_files(str(path))
            expected = {'cancelled': '已取消文件导入', 'failed': '导入失败，当前进度未改动', 'success': '已导入并存入本地'}[outcome]
            expect(self.page.locator('[data-bind="status"]')).to_contain_text(expected)
            self.page.wait_for_function('(i)=>!!window.__ringProtection.files[i] && window.__ringProtection.files[i].text!==null', arg=file_index)
            selected = self.page.evaluate('(i)=>window.__ringProtection.files[i]', file_index)
            check('recovery uses exact immutable natural File.text bytes and native confirmation: '+outcome,
                  selected['trusted'] and selected['text'] == path.read_text() and selected['size'] == path.stat().st_size
                  and selected['beforeRaw'] == raw_before and selected['error'] is None and len(dialogs) == 1
                  and dialogs[0]['valid'] and dialogs[0]['accepted'] == (outcome != 'cancelled'), dialogs)
            self.tab('arcade')
            after = self.snapshot('recovery-'+alias+'-'+outcome+'-after')
            events = self.audit()[event_index:]
            existing = {row['key']: row['raw'] for row in before['storage'] if row['key'] != key}
            actual = {row['key']: row['raw'] for row in after['storage'] if row['key'] != key}
            check('every pre-existing recovery backup retains exact native bytes: '+outcome, all(actual.get(k) == v for k, v in existing.items()))
            if outcome == 'success':
                check('explicit verified replacement adopts the complete natural source only after durable write',
                      after['mode'] == 'ready' and after['state'] == incoming['state'] == json.loads(self.raw())['state'])
                check('successful replacement preserves actual previous current bytes as a native backup', raw_before in actual.values())
                self.assert_ready_notice(after['ringDom'])
            else:
                check('cancelled or failed replacement never unlocks or adopts the incoming state',
                      after['mode'] == before['mode'] == 'protected' and after['state'] == before['state']
                      and self.raw() == raw_before and after['protectedRaw'] == before['protectedRaw'])
                self.assert_locked(after['ringDom'], after['message'])
                if outcome == 'cancelled':
                    check('cancelled native confirmation changes no storage bytes and attempts no write', after['storage'] == before['storage'] and not any(e['operation'].startswith('write-') for e in events))
                else:
                    added = {k: v for k, v in actual.items() if k not in existing}
                    check('failed replacement only preserves the original as an append-only backup', all(v == raw_before for v in added.values()))
                    attempts = [e for e in events if e['operation'] == 'write-attempt' and e['key'] == key]
                    check('accepted replacement really attempts the distinct natural candidate and hits targeted write failure', len(attempts) == 1 and json.loads(attempts[0]['value'])['state'] == incoming['state'] and any(e['operation'] == 'write-throw' and e.get('injected') for e in events))
            self.stage.setdefault('recovery', []).append({'source': alias, 'outcome': outcome, 'dialogs': dialogs,
                'selectedFile': dump_json(case+'-recovery-'+alias+'-'+outcome+'-selected.json', selected),
                'audit': dump_json(case+'-recovery-'+alias+'-'+outcome+'-audit.json', events)})
            return after

        def verify_recovery(self):
            nonlocal active
            self.replace_natural('before_stop', 'cancelled')
            self.replace_natural('before_stop', 'failed')
            self.page.evaluate('window.__ringProtection.inject(null)')
            replaced = self.replace_natural('equipped', 'success')
            check('explicit unarmed source replacement does not revive the old protected batch', replaced['state']['arcade']['autoBatch'] is None)
            self.type('#ring-auto-count', 1)
            self.type('#ring-auto-cap', milestones['armed']['save']['state']['arcade']['autoBatch']['maxDeuterium'])
            ready = self.snapshot('recovery-ready-recomputed')
            check('ready permissions are recomputed from the replacement and current valid draft', not ready['controls']['auto-arm']['disabled'] and ready['controls']['auto-stop']['disabled'] and all(not ready['controls'][name]['disabled'] for name in ('manual-run', 'manual-all', 'bet-plus', 'bet-minus', 'clear', 'slot', 'count', 'cap')))
            check('editing recovered drafts leaves the whole adopted state and all storage bytes unchanged', ready['state'] == replaced['state'] and ready['storage'] == replaced['storage'])
            armed = self.replace_natural('before_stop', 'success')
            check('legitimate explicit source contains its own existing finite armed batch', armed['state']['arcade']['autoBatch']['armed'] is True and armed['state']['arcade']['autoBatch'] == milestones['before_stop']['save']['state']['arcade']['autoBatch'])
            saved_raw, saved_storage = self.raw(), self.storage()
            context = self.page.context
            # Reopen against actual native storage. Default close does not run
            # beforeunload and is not evidence of a close-time persist no-op.
            self.page.close()
            reloaded = Page(context, self.stage, 'reloaded')
            active = reloaded
            reloaded.tab('arcade')
            loaded = reloaded.snapshot('legitimate-armed-native-reload')
            check('fresh real HTTP load of actual native saved bytes preserves the legitimate armed contract', loaded['mode'] == 'ready' and loaded['state'] == armed['state'] and reloaded.raw() == saved_raw and reloaded.storage() == saved_storage and not loaded['controls']['auto-stop']['disabled'])
            check('reload clock has no injected offline gap or batch execution', loaded['clock']['dateNow'] == json.loads(saved_raw)['lastTickAt'] and loaded['clock']['elapsed'] == 0)
            reloaded.assert_ready_notice(loaded['ringDom'])
            for alias in ('stopped', 'curved'):
                adopted = reloaded.replace_natural(alias, 'success')
                expected = milestones[alias]['save']['state']
                check('replacement retains the source-specific stopped batch and disabled card: '+alias,
                      adopted['state']['arcade']['autoBatch'] == expected['arcade']['autoBatch']
                      and adopted['state']['arcade']['autoBatch']['armed'] is False
                      and adopted['state']['protocols'] == expected['protocols']
                      and adopted['controls']['auto-stop']['disabled'])
                reloaded.tab('save')
                reloaded.tab('arcade')
                repeated = reloaded.snapshot('recovery-'+alias+'-revisited')
                check('renderer/tab revisit cannot revive a previously armed batch in replacement: '+alias,
                      repeated['state'] == adopted['state'] and repeated['storage'] == adopted['storage']
                      and repeated['controls']['auto-stop']['disabled'])
                if alias == 'curved':
                    check('natural curvature replacement is genuinely a new world', repeated['state']['stats']['launches'] == armed['state']['stats']['launches'] + 1)
            return reloaded

        def audit(self):
            events = self.page.evaluate('window.__ringProtection.events')
            check('all ordinary input is trusted; labeled adversarial replay is separately identified', all(e['trusted'] or (synchronized and e.get('replay') in ('stale-enabled', 'draft-input-change')) for e in events if e['operation'].startswith('ui-')))
            return events

        def export_original(self, expected, suffix):
            self.tab('save')
            with self.page.expect_download() as pending:
                self.click('[data-action="export"]')
            download = pending.value
            check('original download succeeds', download.failure() is None)
            path = out / f'{case}-{suffix}-protected-original.json'
            download.save_as(path)
            check('export retains complete original bytes exactly', path.read_text() == expected)
            self.stage.setdefault('exports', []).append({'file': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())})
            self.tab('arcade')

    @contextmanager
    def evidence_before_teardown():
        # Diagnostics must be collected before Playwright closes its transport.
        try:
            yield
        except BaseException as error:
            report.update(completed=False, result='failed', failure={'case': case, 'error': repr(error), 'traceback': traceback.format_exc()})
            flush()
            if active and not active.page.is_closed():
                for name, capture in [('snapshot', lambda: active.snapshot('failure')),
                                      ('audit', lambda: dump_json(case+'-failure-audit.json', active.audit())),
                                      ('screenshot', lambda: active.page.screenshot(path=str(out / 'failure.png'), full_page=True, timeout=5000))]:
                    try:
                        capture()
                    except BaseException as diagnostic:
                        report['failure'].setdefault('diagnosticErrors', []).append({'step': name, 'error': repr(diagnostic)})
            flush()
            raise

    def timeout(_signal, _frame):
        raise TimeoutError('Ring protection worker exceeded bounded work interval')

    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(WORK_SECONDS)
    flush()
    try:
        check('native acceptance uses an HTTP(S) directory URL', parsed.scheme in ('http', 'https') and bool(parsed.netloc) and parsed.path.endswith('/') and not parsed.query and not parsed.fragment)
        check('exact source SHA and independent domain report digest supplied', bool(re.fullmatch(r'[0-9a-f]{40}', args.expected_sha or '')) and bool(re.fullmatch(r'[0-9a-f]{64}', args.expected_report_sha256)))
        original = Path(args.report).read_bytes()
        check('complete domain report matches independently captured SHA256', sha(original) == args.expected_report_sha256)
        report['domainSource'] = dump('natural-domain-source-report.json', original)
        source = json.loads(original)
        metadata = source.get('source', {})
        check('passed natural report excludes injected game state and seed search', source.get('schema') == 'infinity-natural-ring-journey-v1' and source.get('outcome', {}).get('status') == 'passed' and source.get('provenance', {}).get('injectedGameState') is False and source.get('provenance', {}).get('seedSearch') is False)
        check('domain report and generator identify exact current release source', source.get('sourceSha') == metadata.get('sourceSha') == metadata.get('gitHead') == args.expected_sha == git('rev-parse', 'HEAD').decode().strip())
        check('natural generator source is tracked and clean', metadata.get('scriptPath') == 'scripts/natural-ring-journey.ts' and metadata.get('scriptDirty') is False and metadata.get('scriptStatusPorcelain') == '')
        generator = repository / metadata['scriptPath']
        check('natural generator hash matches report and exact committed bytes', generator.read_bytes() == git('show', args.expected_sha+':'+metadata['scriptPath']) and sha(generator.read_bytes()) == metadata.get('scriptSha256'))
        check('domain report dirty status only contains generated artifacts', clean_status(metadata.get('worktreeStatusPorcelain')) and metadata.get('worktreeDirty') == bool(metadata.get('worktreeStatusPorcelain')))
        check('acceptance checkout has no runtime/source edits', clean_status(git('status', '--porcelain=v1', '--untracked-files=all').decode().rstrip('\n')))
        production = ['src', 'public', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts']
        if synchronized:
            report['domainProvenance'] = synchronized_domain_provenance(repository, args.expected_sha, git, check)
        else:
            check('baseline reproduction leaves committed production tree byte-identical', git('diff', '--name-only', BASELINE, args.expected_sha, '--', *production) == b'')
        report['domainSource']['sourceMetadata'] = metadata
        key = source['storageKey']
        check('actual original native storage key is unchanged', key == 'infinity.original-p4.save.v1')
        for alias, name in (NAMES | (RECOVERY_NAMES if synchronized else {})).items():
            matches = [m for m in source['milestones'] if m['name'] == name]
            check('natural milestone occurs exactly once: '+name, len(matches) == 1)
            value = matches[0]
            incoming = value['save']
            check('natural save has strict reload provenance and source epoch: '+alias, value['stateAdoptedFromReload'] is True and value['strictRoundtrips'] >= 2 and incoming['savedAt'] == incoming['lastTickAt'] and incoming['revision'] == source['saveRevision'] and incoming['version'] == source['saveVersion'])
            evidence = dump_json('source-'+name+'.json', incoming)
            milestones[alias] = {**value, 'evidence': evidence}
            report['sources'].append({'name': name, **evidence})
        with sync_playwright() as playwright, evidence_before_teardown():
            options = {'headless': True, 'args': ['--no-sandbox', args.owner_marker]}
            executable = args.chromium or shutil.which('google-chrome') or shutil.which('google-chrome-stable') or shutil.which('chromium')
            if executable:
                options['executable_path'] = executable
            browser = playwright.chromium.launch(**options)
            actual_executable = executable or playwright.chromium.executable_path
            report['runtime'].update(executablePath=actual_executable, browserVersion=browser.version,
                executableVersion=subprocess.check_output([actual_executable, '--version'], stderr=subprocess.STDOUT, timeout=10).decode().strip())
            processes()
            request = playwright.request.new_context()
            response = request.get(urljoin(args.url, 'release.json'), timeout=15000)
            check('release metadata is native HTTP 200 from exact origin', response.status == 200 and response.url == urljoin(args.url, 'release.json'))
            release = response.json()
            report['release'] = dump('release.json', response.body())
            check('release pin and save revision match natural source exactly', release.get('sourceSha') == args.expected_sha and release.get('saveRevision') == source['saveRevision'] and release.get('saveVersion') == source['saveVersion'])
            request.dispose()
            for fault in ('write-throw', 'readback-throw', 'second-tab'):
                for alias in ('equipped', 'armed'):
                    case = fault+'-'+alias
                    stage = {'name': case, 'fault': fault, 'source': alias, 'completed': False, 'result': 'running'}
                    report['stages'].append(stage)
                    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True, service_workers='block')
                    epoch = str(milestones[alias]['save']['savedAt'])
                    if synchronized:
                        # A real reload starts at its actual saved timestamp: no
                        # synthetic offline gap consumes an authorized batch.
                        epoch = f'(()=>{{const raw=Storage.prototype.getItem.call(localStorage,{json.dumps(key)});return raw?Math.max({epoch},JSON.parse(raw).lastTickAt):{epoch};}})()'
                    context.add_init_script(INIT.replace('__ORIGIN__', json.dumps(origin)).replace('__KEY__', json.dumps(key)).replace('__EPOCH__', epoch))
                    primary = Page(context, stage, 'primary')
                    active = primary
                    primary.import_source(alias)
                    if alias == 'equipped':
                        primary.type('#ring-auto-count', 1)
                        primary.type('#ring-auto-cap', milestones['armed']['save']['state']['arcade']['autoBatch']['maxDeuterium'])
                    else:
                        # A normal native select returns to the real funded home
                        # without altering the batch's existing fixed source.
                        primary.page.locator('#planet-select').focus()
                        primary.page.keyboard.press('Home')
                        primary.page.keyboard.press('Tab')
                        primary.frame()
                        check('armed source selection uses the actual funded home', primary.frame()['state']['activePlanetId'] == 'homeworld')
                    ready = primary.snapshot('ready')
                    required = ['manual-run', 'manual-all', 'bet-plus', 'bet-minus', 'clear', 'slot', 'count', 'cap', 'auto-arm' if alias == 'equipped' else 'auto-stop']
                    check('every targeted control is genuinely enabled and visible while ready', ready['mode'] == 'ready' and all(ready['controls'][name]['visible'] and not ready['controls'][name]['disabled'] for name in required), ready['controls'])
                    # Independent production-domain preflight for these exact
                    # natural milestones: topUpPrice=234670, home deuterium=140000.
                    # This is a declared negative control, never a positive target.
                    stage['readyDisabledControl'] = {'control': 'topup', 'costFromProductionDomainPreflight': 234670,
                        'availableHomeDeuterium': next(p for p in ready['state']['planets'] if p['id'] == 'homeworld')['resources']['deuterium'],
                        'observedTitle': ready['controls']['topup']['title'], 'misleadingEnabledCoverage': False}
                    check('natural top-up is explicitly disabled before protection for insufficient funds',
                          ready['state']['activePlanetId'] == 'homeworld'
                          and next(p for p in ready['state']['planets'] if p['id'] == 'homeworld')['resources']['deuterium'] == '140000'
                          and ready['controls']['topup']['visible'] and ready['controls']['topup']['disabled']
                          and ready['controls']['topup']['title'] == '重氢不足（需要 2.35e5）', stage['readyDisabledControl'])
                    if synchronized:
                        primary.assert_ready_notice(ready['ringDom'])
                    original_raw = primary.raw()
                    original_storage = primary.storage()
                    primary.page.evaluate('window.__ringProtection.events.length=0')
                    if fault != 'second-tab':
                        primary.tab('save')
                        primary.page.evaluate('kind=>window.__ringProtection.inject(kind)', fault)
                        # One millisecond changes the envelope but no simulation
                        # frame runs until the protected save has returned.
                        primary.page.evaluate('window.__ringProtection.advance(1)')
                        if synchronized:
                            observed_before = primary.page.evaluate('window.__ringProtection.observed.length')
                            if fault == 'write-throw' and alias == 'equipped':
                                stage['entryVisibility'] = primary.page.evaluate('''() => {
                                  const p=window.__ringProtection;
                                  const native={hidden:document.hidden,visibilityState:document.visibilityState};
                                  const hidden=Object.getOwnPropertyDescriptor(document,'hidden');
                                  const visibility=Object.getOwnPropertyDescriptor(document,'visibilityState');
                                  try {
                                    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
                                    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>"hidden"});
                                    const autosaves=p.autosave();
                                    return {label:'synthetic hidden document, controlled RAF stopped; not native background',native,autosaves,observations:p.observed.length};
                                  } finally {
                                    if(hidden)Object.defineProperty(document,'hidden',hidden);else delete document.hidden;
                                    if(visibility)Object.defineProperty(document,'visibilityState',visibility);else delete document.visibilityState;
                                  }
                                }''')
                                check('one original autosave runs while synthetically hidden without a RAF', stage['entryVisibility']['autosaves'] == 1 and stage['entryVisibility']['observations'] == observed_before, stage['entryVisibility'])
                            else:
                                primary.click('[data-action="save"]', run_frame=False)
                            immediate = primary.ring_dom()
                            check('protected DOM disables all mutators before first post-failure RAF', primary.page.evaluate('window.__ringProtection.observed.length') == observed_before)
                            primary.assert_locked(immediate)
                            stage['immediateProtectionDom'] = dump_json(case+'-immediate-dom.json', immediate)
                        else:
                            primary.click('[data-action="save"]')
                        events = primary.audit()
                        attempts = [e for e in events if e['operation'] == 'write-attempt' and e['key'] == key]
                        returns = [e for e in events if e['operation'] == 'write-return' and e['key'] == key]
                        injected = [e for e in events if e.get('injected')]
                        check('one exact current-key candidate excludes legal same-byte no-op', len(attempts) == 1 and attempts[0]['before'] == original_raw and attempts[0]['value'] != original_raw and json.loads(attempts[0]['value'])['state'] == ready['state'], {'attempts': len(attempts)})
                        check('fault targets exactly one current-key operation', len(injected) == 1 and injected[0]['key'] == key and injected[0]['operation'] == ('write-throw' if fault == 'write-throw' else 'read-throw'), injected)
                        if fault == 'write-throw':
                            check('throw prevents native current write and preserves all storage bytes', not returns and primary.storage() == original_storage)
                        else:
                            check('write really succeeds before immediate application readback refusal', len(returns) == 1 and returns[0]['actual'] == attempts[0]['value'] == primary.raw() and events.index(returns[0]) < events.index(injected[0]))
                            check('readback failure retains previous complete state and changes envelope only', json.loads(primary.raw())['state'] == ready['state'] and primary.raw() != original_raw)
                            check('successful uncertain current write leaves every existing backup byte intact', [x for x in primary.storage() if x['key'] != key] == [x for x in original_storage if x['key'] != key])
                        primary.tab('arcade')
                    else:
                        other = Page(context, stage, 'second')
                        other.import_source('before_stop' if alias == 'equipped' else 'equipped')
                        expected_other = other.raw()
                        primary.page.wait_for_function('window.__ringProtection.events.some(e=>e.operation==="storage-event"&&e.trusted)')
                        events = primary.audit()
                        storage_events = [e for e in events if e['operation'] == 'storage-event']
                        check('same-origin second production tab supplies a real trusted current storage event', any(e['trusted'] and e['key'] == key and e['oldValue'] == original_raw and e['newValue'] == expected_other and e['url'] == args.url for e in storage_events), storage_events)
                        check('second tab update used normal confirmed native import with no fault', other.page.evaluate('window.__ringProtection.fault') is None and expected_other != original_raw and primary.raw() == expected_other)
                        stage['secondTabAudit'] = dump_json(case+'-second-native-audit.json', other.audit())
                        if synchronized:
                            immediate = primary.ring_dom()
                            primary.assert_locked(immediate)
                            stage['immediateProtectionDom'] = dump_json(case+'-immediate-dom.json', immediate)
                            # The competing writer has finished. Default close
                            # does not execute beforeunload; no close-save coverage is claimed.
                            other.page.close()
                            check('closing completed competing tab preserves its exact current bytes', primary.raw() == expected_other)
                    protected = primary.snapshot('protected')
                    mode = 'conflict' if fault == 'second-tab' else 'protected'
                    check('actual session mode and visible notice corroborate protection', protected['mode'] == mode and protected['visibleNotice'] and ('其他标签页' if fault == 'second-tab' else '原件已保留并受保护') in protected['noticeText'], {'mode': protected['mode'], 'notice': protected['noticeText'], 'status': protected['status']})
                    check('entering protection retains whole original economic state and original bytes', protected['state'] == ready['state'] and protected['protectedRaw'] == original_raw)
                    if synchronized:
                        primary.assert_locked(immediate, protected['message'])
                        primary.assert_locked(protected['ringDom'], protected['message'])
                        check('first protection observation retains the exact old expected current bytes', protected['expectedRaw'] == original_raw)
                        check('ring-local raw protection cause is visible on the active ring tab', protected['ringDom']['protection']['visible'])
                        if alias == 'armed':
                            check('protected armed status retains authorization but explicitly freezes execution', protected['ringDom']['autoStatus'] == '存档受保护 · 授权记录保留，执行冻结')
                        check('ready-disabled top-up retains the original affordability title', protected['controls']['topup']['disabled'] and protected['controls']['topup']['title'] == ready['controls']['topup']['title'])
                        primary.verify_fixed_controls(protected, mode)
                        if fault == 'write-throw' and alias == 'equipped':
                            primary.verify_protected_viewports(protected, mode)
                    else:
                        mismatches = [name for name in required if protected['controls'][name]['visible'] and not protected['controls'][name]['disabled']]
                        check('known misleading-enabled UI limitation is actually reproduced', set(required) <= set(mismatches), {'misleadingEnabled': mismatches, 'notASafetyPass': True})
                        check('known ready-disabled top-up stays disabled across protection', protected['controls']['topup']['disabled'] and protected['controls']['topup']['title'] == ready['controls']['topup']['title'])
                        stage['misleadingEnabledControls'] = mismatches
                        baseline_state, baseline_storage = protected['state'], protected['storage']
                        primary.export_original(original_raw, 'before-actions')
                        primary.page.evaluate('window.__ringProtection.events.length=0')
                        targets = ['manual-run', 'manual-all', 'bet-plus', 'bet-minus', 'clear', 'auto-arm' if alias == 'equipped' else 'auto-stop']
                        for name in targets:
                            before = len(primary.audit())
                            primary.click(CONTROLS[name])
                            after = primary.snapshot('after-'+name)
                            action_events = primary.audit()[before:]
                            check('misleading enabled target receives genuine browser click: '+name, any(e['operation'] == 'ui-click' and e['trusted'] and (e.get('action') or e.get('ring')) == ('arcade-bet' if name.startswith('bet-') else 'arcade-bet-clear' if name == 'clear' else 'arcade-topup' if name == 'topup' else 'arcade-'+name.removeprefix('manual-') if name.startswith('manual-') else name) for e in action_events))
                            check('guard rejects clicked action without any whole-state/native-byte change: '+name, after['state'] == baseline_state and after['storage'] == baseline_storage and after['mode'] == mode)
                            check('blocked action attempts no native save write: '+name, not any(e['operation'].startswith('write-') for e in action_events))
                        primary.type('#ring-auto-count', 2)
                        primary.type('#ring-auto-cap', '19555')
                        draft = primary.snapshot('after-enabled-inputs')
                        check('enabled protected inputs can edit drafts but cannot change economic state/storage', draft['state'] == baseline_state and draft['storage'] == baseline_storage)
                        primary.frame(3000)
                        check('actual autosave callback is present', primary.page.evaluate('window.__ringProtection.autosave()') == 1)
                        terminal = primary.snapshot('after-tick-autosave')
                        check('original application RAF after a 3-second clock advance and autosave leave protected state frozen', terminal['state'] == baseline_state and terminal['storage'] == baseline_storage and terminal['mode'] == mode)
                        check('all protected actions, draft edits, tick and autosave attempt zero writes', not any(e['operation'].startswith('write-') for e in primary.audit()))
                        stage['blockedActionAudit'] = dump_json(case+'-blocked-actions-native-audit.json', primary.audit())
                    stage['entryAudit'] = dump_json(case+'-entry-native-audit.json', events)
                    primary.export_original(original_raw, 'after-actions')
                    primary.page.screenshot(path=str(out / (case+'-protected.png')), full_page=True, timeout=7000)
                    stage['screenshot'] = {'file': case+'-protected.png', 'sha256': sha((out / (case+'-protected.png')).read_bytes())}
                    if synchronized and fault == 'write-throw' and alias == 'armed':
                        primary = primary.verify_recovery()
                    stage.update(completed=True, result=RESULTS[args.expect], handlerGuardVerified=True, uiCorrect=synchronized)
                    flush()
                    context.close()
                    active = None
                    processes()
            check('all six independent fault/source stages satisfy the selected explicit expectation', len(report['stages']) == 6 and all(s['completed'] and s['result'] == RESULTS[args.expect] for s in report['stages']))
            check('no uncaught application errors or failed resource requests', not report['errors'] and not report['failedRequests'], {'errors': report['errors'], 'failedRequests': report['failedRequests']})
            report.update(completed=True, result=RESULTS[args.expect], uiCorrect=synchronized)
            flush()
            browser.close()
            browser = None
    except BaseException as error:
        if 'failure' not in report:
            report['failure'] = {'case': case, 'error': repr(error), 'traceback': traceback.format_exc()}
        report.update(completed=False, result='failed')
        flush()
    finally:
        signal.alarm(0)
        if browser:
            try:
                processes()
                browser.close()
            except BaseException as cleanup:
                report.setdefault('cleanupErrors', []).append(repr(cleanup))
                report.update(completed=False, result='failed')
        flush()
    return 0 if report['completed'] and report['result'] == RESULTS[args.expect] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
    parser.add_argument('--report', default='natural-ring-report.json')
    parser.add_argument('--output', default='ring-protection-evidence', help='Must be empty')
    parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA'))
    parser.add_argument('--expected-report-sha256', required=True)
    parser.add_argument('--expect', required=True, choices=tuple(RESULTS))
    parser.add_argument('--chromium')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--owner-marker', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker and not args.owner_marker:
        parser.error('The worker is internal; run through the independent supervisor.')
    return worker(args) if args.worker else supervise(args)


if __name__ == '__main__':
    raise SystemExit(main())
