"""Independent r11 null-slot expectations; frozen r10 grant contract remains intact."""
from copy import deepcopy
from r10_compatibility import (
    exact_json, lift_legacy_state_to_r10,
    assert_zero_grant_metadata as assert_r10_zero_grant_metadata,
    project_verified_r10_metadata,
)

CURRENT_REVISION = 11


def lift_r10_state_to_r11(state):
    expected = deepcopy(state)
    for index, source in enumerate(state['planets']):
        assert 'demolition' not in source, 'Historical source cannot already carry the new slot'
        assert 'buildQueue' in source
        planet = {}
        for key, value in source.items():
            planet[key] = deepcopy(value)
            if key == 'buildQueue':
                planet['demolition'] = None
        expected['planets'][index] = planet
    return expected


def assert_null_demolition_slots(actual, historical):
    assert [p['id'] for p in actual['planets']] == [p['id'] for p in historical['planets']], 'Planet identity/order changed'
    prior = deepcopy(actual)
    for planet in prior['planets']:
        assert 'demolition' in planet and planet['demolition'] is None, 'Every migrated planet must have exactly a null slot'
        del planet['demolition']
    return prior


def lift_legacy_state_to_r11(state, *, source_revision, grant_job_floor):
    return lift_r10_state_to_r11(lift_legacy_state_to_r10(
        state, source_revision=source_revision, grant_job_floor=grant_job_floor))


def assert_zero_grant_metadata(actual, historical, *, grant_job_floor):
    return assert_r10_zero_grant_metadata(assert_null_demolition_slots(actual, historical), historical,
                                         grant_job_floor=grant_job_floor)


def project_verified_r11_metadata(actual, historical, *, grant_job_floor):
    return project_verified_r10_metadata(assert_null_demolition_slots(actual, historical), historical,
                                         grant_job_floor=grant_job_floor)
