"""Strict inactive r16 extension over frozen r2-r14 migration expectations.

No production reader executes here. Callers first obtain the genuine historical
reader's complete state. Only the new exact inactive challenge field is added
or independently verified before projection; every old value remains intact.
"""
from copy import deepcopy
import math
import r14_compatibility as _r14
from r14_compatibility import (
    exact_json, expected_npc_economy, advance_expected_npc_wallet,
    expected_npc_from_r12_snapshot, expected_npc_resource_remainder,
    expected_npc_battles, assert_zero_npc_resource_remainders,
)

CURRENT_REVISION = 16
ENERGY_MODEL = 'energy-tightening-v1'


def expected_inactive_energy_challenge():
    return {'model': ENERGY_MODEL, 'nextAttemptId': 1, 'active': None, 'completion': None}


def _plain_data(value, *, current=False, path=(), active=None):
    active = set() if active is None else active
    if type(value) in (dict, list):
        assert id(value) not in active, 'Cyclic data cannot be copied or projected'
        active.add(id(value))
        try:
            for key, child in (value.items() if type(value) is dict else enumerate(value)):
                if type(value) is dict:
                    assert type(key) is str, 'Every JSON object key must be a string'
                    if key == 'energyChallenge':
                        assert current and not path, 'Historical or misplaced challenge authority is forbidden'
                    if key == 'model' and child == ENERGY_MODEL:
                        assert current and path == ('energyChallenge',), 'Misplaced challenge model authority is forbidden'
                _plain_data(child, current=current, path=(*path, key), active=active)
        finally:
            active.remove(id(value))
    else:
        assert value is None or type(value) in (str, int, float, bool), 'Only exact JSON data can be copied'
        if type(value) in (int, float):
            assert math.isfinite(value), 'Nonfinite values cannot be silently normalized'


def assert_inactive_energy_challenge(state):
    assert type(state) is dict and 'energyChallenge' in state, 'Explicit complete state and challenge field required'
    value = state['energyChallenge']
    assert type(value) is dict and set(value) == {'model', 'nextAttemptId', 'active', 'completion'}, 'Exact challenge keys required'
    assert type(value['model']) is str and value['model'] == ENERGY_MODEL, 'Exact challenge model required'
    assert type(value['nextAttemptId']) is int and value['nextAttemptId'] == 1, 'Exact fresh attempt counter required'
    assert value['active'] is None and value['completion'] is None, 'Only unearned inactive state may be projected'
    _plain_data(state, current=True)
    return True


def project_verified_inactive_energy_challenge(state):
    assert_inactive_energy_challenge(state)
    prior = deepcopy(state)
    del prior['energyChallenge']
    return prior


def lift_r14_state_to_r16(state):
    assert type(state) is dict and 'energyChallenge' not in state, 'Genuine historical state without challenge authority required'
    _plain_data(state)
    return {'energyChallenge': expected_inactive_energy_challenge(), **deepcopy(state)}


def lift_r14_envelope_to_r16(envelope):
    _plain_data(envelope)
    assert type(envelope) is dict and envelope.get('schema') == 'infinity-original-p4'
    assert type(envelope.get('version')) is int and envelope['version'] == 9
    assert type(envelope.get('revision')) is int and envelope['revision'] == 14, 'Only genuine r14 envelope may use this adapter'
    return {**deepcopy(envelope), 'revision': CURRENT_REVISION, 'state': lift_r14_state_to_r16(envelope['state'])}


def lift_r13_state_to_r16(state):
    _plain_data(state)
    return lift_r14_state_to_r16(_r14.lift_r13_state_to_r14(state))


def lift_r12_state_to_r16(state):
    _plain_data(state)
    return lift_r14_state_to_r16(_r14.lift_r12_state_to_r14(state))


def lift_r11_state_to_r16(state, *, npc_wallet=None):
    _plain_data(state)
    return lift_r14_state_to_r16(_r14.lift_r11_state_to_r14(state, npc_wallet=npc_wallet))


def lift_r10_state_to_r16(state, *, npc_wallet=None):
    _plain_data(state)
    return lift_r14_state_to_r16(_r14.lift_r10_state_to_r14(state, npc_wallet=npc_wallet))


def lift_legacy_state_to_r16(state, *, source_revision, grant_job_floor, npc_wallet=None):
    _plain_data(state)
    return lift_r14_state_to_r16(_r14.lift_legacy_state_to_r14(
        state, source_revision=source_revision, grant_job_floor=grant_job_floor, npc_wallet=npc_wallet))


def assert_npc_economy(actual, *, npc_wallet):
    return _r14.assert_npc_economy(project_verified_inactive_energy_challenge(actual), npc_wallet=npc_wallet)


def project_verified_npc_metadata(actual, *, npc_wallet):
    return _r14.project_verified_npc_metadata(project_verified_inactive_energy_challenge(actual), npc_wallet=npc_wallet)


def assert_zero_grant_metadata(actual, historical, *, grant_job_floor, npc_wallet):
    return _r14.assert_zero_grant_metadata(project_verified_inactive_energy_challenge(actual), historical,
                                          grant_job_floor=grant_job_floor, npc_wallet=npc_wallet)


def project_verified_r16_metadata(actual, historical, *, grant_job_floor, npc_wallet):
    return _r14.project_verified_r14_metadata(project_verified_inactive_energy_challenge(actual), historical,
                                             grant_job_floor=grant_job_floor, npc_wallet=npc_wallet)
