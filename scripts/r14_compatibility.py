"""Independent r14 null-slot expectations over the frozen historical contracts.

Only exact null message slots may be projected. No production reader is imported;
callers must obtain the complete old state from its genuine historical reader.
The r13 wallet, receipts, rights and all other old values are copied unchanged.
"""
from copy import deepcopy
import math
import r13_compatibility as _r13
from r13_compatibility import (
    exact_json, expected_npc_economy, advance_expected_npc_wallet,
    expected_npc_from_r12_snapshot, expected_npc_resource_remainder,
    expected_npc_battles, assert_zero_npc_resource_remainders,
)

CURRENT_REVISION = 14
SNAPSHOT_FIELD = 'npcScoutSnapshot'
SNAPSHOT_MODEL = 'npc-scout-snapshot-v1'
MESSAGE_KEYS = {'id', 'at', 'text'}


def _scan_plain_data(value, *, allow_message_slots=False, path=(), active=None):
    """Reject erased/hidden authority before copying or projecting any field."""
    active = set() if active is None else active
    if type(value) in (dict, list):
        assert id(value) not in active, 'Cyclic input is not plain JSON data'
        active.add(id(value))
        try:
            entries = value.items() if type(value) is dict else enumerate(value)
            for key, child in entries:
                if type(value) is dict:
                    assert type(key) is str, 'JSON object keys must be strings'
                    if key == SNAPSHOT_FIELD:
                        assert (allow_message_slots and len(path) == 2
                                and path[0] == 'messages' and type(path[1]) is int
                                and child is None), 'Only explicit null canonical message slots may be projected'
                _scan_plain_data(child, allow_message_slots=allow_message_slots,
                                 path=(*path, key), active=active)
        finally:
            active.remove(id(value))
    else:
        assert value is None or type(value) in (str, int, float, bool), 'Only exact plain JSON data is accepted'
        if type(value) in (int, float):
            assert math.isfinite(value), 'Nonfinite source values cannot be projected'
        if type(value) is str:
            assert value != SNAPSHOT_MODEL, 'Reserved snapshot model cannot be hidden in historical state'


def _messages(state, *, current):
    assert type(state) is dict and type(state.get('messages')) is list, 'Complete ordinary message list required'
    assert len(state['messages']) <= 150, 'Historical message quota changed'
    _scan_plain_data(state, allow_message_slots=current)
    ids = set()
    for message in state['messages']:
        assert type(message) is dict and set(message) == MESSAGE_KEYS | ({SNAPSHOT_FIELD} if current else set()), 'Every message must have exactly its declared fields'
        assert type(message['id']) is str and len(message['id'].encode('utf-16-le', errors='surrogatepass')) // 2 <= 100
        assert message['id'] not in ids, 'Historical message IDs must remain unique'
        ids.add(message['id'])
        assert type(message['text']) is str and len(message['text'].encode('utf-16-le', errors='surrogatepass')) // 2 <= 1000
        assert type(message['at']) in (int, float) and math.isfinite(message['at']) and 0 <= message['at'] <= 1e12
        if current:
            assert message[SNAPSHOT_FIELD] is None, 'Only independently proved null snapshots may be projected'


def lift_r13_state_to_r14(state):
    """Preserve old values with the r14 message order and one explicit null."""
    _messages(state, current=False)
    expected = deepcopy(state)
    # The r14 message serializer has this explicit order, unlike older readers
    # that preserve id/text/at. Validate first so rebuilding cannot erase fields.
    expected['messages'] = [
        {'id': message['id'], 'at': message['at'], 'text': message['text'], SNAPSHOT_FIELD: None}
        for message in expected['messages']
    ]
    return expected


def project_verified_r14_scout_metadata(actual):
    """Remove only independently checked null slots, never actual observations."""
    _messages(actual, current=True)
    prior = deepcopy(actual)
    for message in prior['messages']:
        del message[SNAPSHOT_FIELD]
    return prior


def lift_r12_state_to_r14(state):
    _messages(state, current=False)
    return lift_r13_state_to_r14(_r13.lift_r12_state_to_r13(state))


def lift_r11_state_to_r14(state, *, npc_wallet=None):
    _messages(state, current=False)
    return lift_r13_state_to_r14(_r13.lift_r11_state_to_r13(state, npc_wallet=npc_wallet))


def lift_r10_state_to_r14(state, *, npc_wallet=None):
    _messages(state, current=False)
    return lift_r13_state_to_r14(_r13.lift_r10_state_to_r13(state, npc_wallet=npc_wallet))


def lift_legacy_state_to_r14(state, *, source_revision, grant_job_floor, npc_wallet=None):
    _messages(state, current=False)
    return lift_r13_state_to_r14(_r13.lift_legacy_state_to_r13(
        state, source_revision=source_revision, grant_job_floor=grant_job_floor, npc_wallet=npc_wallet))


def assert_npc_economy(actual, *, npc_wallet):
    return _r13.assert_npc_economy(project_verified_r14_scout_metadata(actual), npc_wallet=npc_wallet)


def project_verified_npc_metadata(actual, *, npc_wallet):
    return _r13.project_verified_npc_metadata(project_verified_r14_scout_metadata(actual), npc_wallet=npc_wallet)


def assert_zero_grant_metadata(actual, historical, *, grant_job_floor, npc_wallet):
    return _r13.assert_zero_grant_metadata(project_verified_r14_scout_metadata(actual), historical,
                                          grant_job_floor=grant_job_floor, npc_wallet=npc_wallet)


def project_verified_r14_metadata(actual, historical, *, grant_job_floor, npc_wallet):
    return _r13.project_verified_r13_metadata(project_verified_r14_scout_metadata(actual), historical,
                                             grant_job_floor=grant_job_floor, npc_wallet=npc_wallet)
