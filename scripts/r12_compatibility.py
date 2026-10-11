"""Independent r12 expectations layered over the frozen historical r10/r11 proofs.

Pure migration adds age zero. Runtime callers must supply the independently
observed adopted age; candidate NPC data is never an input to its own oracle.
No production reader, serializer, clock, or economy implementation is imported.
"""
from copy import deepcopy
import math

from r11_compatibility import (
    exact_json, lift_r10_state_to_r11, lift_legacy_state_to_r11,
    assert_zero_grant_metadata as assert_r11_zero_grant_metadata,
    project_verified_r11_metadata,
)

CURRENT_REVISION = 12
NPC_MODEL = 'fixed-production-v1'
MAX_NPC_SECONDS = 11900


def expected_npc_economy(elapsed_seconds):
    assert type(elapsed_seconds) in (int, float) and math.isfinite(elapsed_seconds)
    assert 0 <= elapsed_seconds <= MAX_NPC_SECONDS
    # JSON has one numeric type; canonical JS JSON.stringify prints integral
    # Number values without a decimal suffix (including negative zero).
    age = int(elapsed_seconds) if elapsed_seconds == int(elapsed_seconds) else elapsed_seconds
    return {'model': NPC_MODEL, 'elapsedSeconds': age}


def npc_elapsed_from_segments(segments):
    """Replay only independently witnessed old-engine Number additions in order."""
    assert type(segments) is list, 'A complete ordered adopted-segment observation is required'
    age = 0.0
    for step in segments:
        assert type(step) in (int, float) and math.isfinite(step) and step >= 0
        age = min(MAX_NPC_SECONDS, age + step)
    return expected_npc_economy(age)['elapsedSeconds']


def lift_r11_state_to_r12(state, *, npc_elapsed=0):
    """Add one exact first-position field, without aliasing or rewriting old state."""
    assert 'npcEconomy' not in state, 'Historical source cannot already carry NPC metadata'
    return {'npcEconomy': expected_npc_economy(npc_elapsed), **deepcopy(state)}


def lift_r10_state_to_r12(state, *, npc_elapsed=0):
    return lift_r11_state_to_r12(lift_r10_state_to_r11(state), npc_elapsed=npc_elapsed)


def lift_legacy_state_to_r12(state, *, source_revision, grant_job_floor, npc_elapsed=0):
    return lift_r11_state_to_r12(lift_legacy_state_to_r11(
        state, source_revision=source_revision, grant_job_floor=grant_job_floor), npc_elapsed=npc_elapsed)


def assert_npc_economy(actual, *, npc_elapsed):
    """Check exact shape, model, numeric type and independent age before removal."""
    expected = expected_npc_economy(npc_elapsed)
    assert 'npcEconomy' in actual, 'Current state must contain its NPC economy'
    npc = actual['npcEconomy']
    assert type(npc) is dict and set(npc) == {'model', 'elapsedSeconds'}, 'Only exact NPC metadata is admitted'
    assert type(npc['model']) is str and npc['model'] == expected['model']
    assert type(npc['elapsedSeconds']) in (int, float) and math.isfinite(npc['elapsedSeconds'])
    assert npc['elapsedSeconds'] == expected['elapsedSeconds'], 'NPC age differs from independently adopted time'
    return True


def project_verified_npc_metadata(actual, *, npc_elapsed):
    assert_npc_economy(actual, npc_elapsed=npc_elapsed)
    projected = deepcopy(actual)
    del projected['npcEconomy']
    return projected


def assert_zero_grant_metadata(actual, historical, *, grant_job_floor, npc_elapsed):
    return assert_r11_zero_grant_metadata(project_verified_npc_metadata(actual, npc_elapsed=npc_elapsed),
                                         historical, grant_job_floor=grant_job_floor)


def project_verified_r12_metadata(actual, historical, *, grant_job_floor, npc_elapsed):
    return project_verified_r11_metadata(project_verified_npc_metadata(actual, npc_elapsed=npc_elapsed),
                                         historical, grant_job_floor=grant_job_floor)
