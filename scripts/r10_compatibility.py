"""Independent, metadata-only expectations for native r10 browser contracts.

Never import the production reader/serializer here. Historical bytes stay intact;
callers supply the fixed migration-time job floor, including for later traces.
"""
from copy import deepcopy
import json

CURRENT_REVISION = 10
CURRENT_VERSION = '0.6.16-alpha.1'
MAX_SAFE_INTEGER = 9_007_199_254_740_991


def exact_json(actual, expected):
    """Compare every value, scalar type and array position, ignoring object order."""
    return json.dumps(actual, sort_keys=True, separators=(',', ':'), allow_nan=False) == json.dumps(expected, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _safe_integer(value, minimum=0):
    return type(value) is int and minimum <= value <= MAX_SAFE_INTEGER


def _historical_has_no_grant_fields(value):
    if isinstance(value, dict):
        assert 'terraformerGrantJobFloor' not in value and 'terraformerFields' not in value, 'Historical source cannot contain r10 grant metadata'
        for child in value.values():
            _historical_has_no_grant_fields(child)
    elif isinstance(value, list):
        for child in value:
            _historical_has_no_grant_fields(child)


def lift_legacy_state_to_r10(state, *, source_revision, grant_job_floor):
    """Add only approved metadata, in the independently specified native order.

    State must already contain the historical r8 shape (or full native r9 shape).
    The floor is deliberately mandatory: deriving it from a post-tick counter
    would hide an implementation that moves the original payment boundary.
    """
    assert source_revision in (8, 9), 'Only complete r8/r9 historical shapes are lifted here'
    _historical_has_no_grant_fields(state)
    assert _safe_integer(grant_job_floor, 1) and grant_job_floor <= state['orders']['nextJobId']
    if source_revision == 8:
        assert 'buildingTemplates' not in state, 'Actual r8 must not contain the r9 library'
        historical = {'buildingTemplates': {'nextTemplateId': 1, 'templates': []}, **deepcopy(state)}
    else:
        assert 'buildingTemplates' in state, 'Actual r9 must retain its complete building library'
        historical = deepcopy(state)
    expected = {'terraformerGrantJobFloor': grant_job_floor, **historical}
    for index, source in enumerate(state['planets']):
        assert 'fieldsMax' in source and 'buildings' in source
        planet = {}
        for key, value in source.items():
            planet[key] = deepcopy(value)
            if key == 'fieldsMax':
                planet['terraformerFields'] = {'base': value, 'grantedLevels': 0}
        expected['planets'][index] = planet
    return expected


def assert_zero_grant_metadata(actual, historical, *, grant_job_floor):
    """Validate every new field independently before any old-state projection."""
    assert _safe_integer(actual['terraformerGrantJobFloor'], 1)
    assert actual['terraformerGrantJobFloor'] == grant_job_floor, 'Migration floor moved after its fixed starting boundary'
    assert _safe_integer(actual['orders']['nextJobId'], 1)
    assert grant_job_floor <= actual['orders']['nextJobId']
    assert len(actual['planets']) == len(historical['planets'])
    grant_count = 0
    for current, source in zip(actual['planets'], historical['planets']):
        assert current['id'] == source['id'], 'Planet order/identity changed'
        ledger = current['terraformerFields']
        assert type(ledger) is dict and set(ledger) == {'base', 'grantedLevels'}
        assert type(ledger['base']) is int and 1 <= ledger['base'] <= 10000
        assert _safe_integer(ledger['grantedLevels'])
        assert ledger['base'] == source['fieldsMax'] and ledger['grantedLevels'] == 0
        assert type(current['fieldsMax']) is int and current['fieldsMax'] == ledger['base'] + 5 * ledger['grantedLevels'] <= 10000
        grant_count += ledger['grantedLevels']
    jobs = [job for planet in actual['planets'] for queue in ('buildQueue', 'shipyardQueue') for job in planet[queue]] + list(actual['research']['queue'])
    ids = [job['jobId'] for job in jobs]
    assert all(_safe_integer(job_id, 1) and job_id < actual['orders']['nextJobId'] for job_id in ids)
    assert len(ids) == len(set(ids)), 'Paid job identity must remain unique across all queues'
    # A partially completed ship batch occupies one issued ID, never its count.
    paid_since_floor = sum(job_id >= grant_job_floor for job_id in ids)
    assert grant_count + paid_since_floor <= actual['orders']['nextJobId'] - grant_job_floor
    return True


def project_verified_r10_metadata(actual, historical, *, grant_job_floor):
    """Remove exactly verified new fields; never remove/alter old fieldsMax."""
    assert_zero_grant_metadata(actual, historical, grant_job_floor=grant_job_floor)
    projected = deepcopy(actual)
    del projected['terraformerGrantJobFloor']
    for planet in projected['planets']:
        del planet['terraformerFields']
    return projected
