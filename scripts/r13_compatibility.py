"""Independent no-attack r13 wallet/receipt expectations; historical helpers frozen.
Only ordered old-engine Number segments advance a wallet. Capped r12 age cannot.
No-attack historical parity permits only independently proved zero planet rights.
"""
from copy import deepcopy
import math
from r11_compatibility import (exact_json, lift_r10_state_to_r11, lift_legacy_state_to_r11,
    assert_zero_grant_metadata as assert_r11_zero_grant_metadata, project_verified_r11_metadata)
CURRENT_REVISION = 13
NPC_MODEL = 'npc-wallet-garrison-v1'
NPC_HORIZON = 12000
INITIAL, CAPS, RATES = [500, 250, 0], [50000, 30000, 10000], [5, 2.5, 1]

def _number(value):
    assert type(value) in (int, float) and math.isfinite(value)
    return int(value) if value == int(value) else value

def _wallet(value):
    assert type(value) is dict and set(value) == {'model','now','baseline','sites'}
    assert value['model'] == NPC_MODEL and 0 <= _number(value['now']) < NPC_HORIZON
    assert type(value['baseline']) is dict and set(value['baseline']) == {'stock','mark'}
    assert type(value['baseline']['mark']) in (int, float) and value['baseline']['mark'] == 0
    assert type(value['baseline']['stock']) is list and len(value['baseline']['stock']) == 3
    for stock, cap in zip(value['baseline']['stock'], CAPS): assert 0 <= _number(stock) <= cap
    assert type(value['sites']) is dict and not value['sites']
    return value

def expected_npc_economy(segments=None):
    return advance_expected_npc_wallet({'model':NPC_MODEL,'now':0,'baseline':{'stock':INITIAL[:],'mark':0},'sites':{}}, [] if segments is None else segments)

def advance_expected_npc_wallet(prior, segments):
    wallet = deepcopy(_wallet(prior))
    assert type(segments) is list, 'Complete ordered segment witness required, never capped old age'
    for step in segments:
        _number(step); assert step >= 0
        if step == 0: continue
        full = step >= NPC_HORIZON
        endpoint = 0 if full else float(wallet['now']) + float(step)
        if not full and endpoint < NPC_HORIZON: wallet['now'] = _number(endpoint)
        else:
            stock = CAPS[:] if full else [min(cap, float(n) + rate * (endpoint - wallet['baseline']['mark'])) for n, rate, cap in zip(wallet['baseline']['stock'], RATES, CAPS)]
            wallet = {'model':NPC_MODEL,'now':0,'baseline':{'stock':[_number(n) for n in stock],'mark':0},'sites':{}}
    return wallet

def expected_npc_from_r12_snapshot(old):
    assert type(old) is dict and set(old) == {'model','elapsedSeconds'} and old['model'] == 'fixed-production-v1'
    age = _number(old['elapsedSeconds']); assert 0 <= age <= 11900
    return {'model':NPC_MODEL,'now':0,'baseline':{'stock':[_number(min(cap, initial + rate * float(age))) for initial, rate, cap in zip(INITIAL,RATES,CAPS)],'mark':0},'sites':{}}

def expected_npc_resource_remainder(): return {'metal':'0','crystal':'0','deuterium':'0'}

def assert_zero_npc_resource_remainders(state):
    assert type(state.get('planets')) is list, 'Complete planet list required'
    for planet in state['planets']:
        assert type(planet) is dict and 'npcResourceRemainder' in planet
        assert exact_json(planet['npcResourceRemainder'],expected_npc_resource_remainder()), 'No-attack zero rights only; positive claims cannot be projected away'
    return True

def _lift_zero_npc_resource_remainders(state):
    prior=deepcopy(state)
    assert type(prior.get('planets')) is list, 'Historical complete planet list required'
    for planet in prior['planets']:
        assert 'npcResourceRemainder' not in planet, 'Legacy input cannot smuggle current rights'
        planet['npcResourceRemainder']=expected_npc_resource_remainder()
    return prior

def expected_npc_battles(): return {'model':'npc-battle-receipts-v1','reports':[]}

def lift_r11_state_to_r13(state, *, npc_wallet=None):
    assert 'npcEconomy' not in state and 'npcBattles' not in state
    return {'npcEconomy':deepcopy(_wallet(expected_npc_economy() if npc_wallet is None else npc_wallet)), 'npcBattles':expected_npc_battles(), **_lift_zero_npc_resource_remainders(state)}

def lift_r12_state_to_r13(state):
    assert 'npcBattles' not in state
    prior = deepcopy(state); wallet = expected_npc_from_r12_snapshot(prior.pop('npcEconomy'))
    return lift_r11_state_to_r13(prior, npc_wallet=wallet)

def lift_r10_state_to_r13(state, *, npc_wallet=None):
    return lift_r11_state_to_r13(lift_r10_state_to_r11(state), npc_wallet=npc_wallet)

def lift_legacy_state_to_r13(state, *, source_revision, grant_job_floor, npc_wallet=None):
    return lift_r11_state_to_r13(lift_legacy_state_to_r11(state,source_revision=source_revision,grant_job_floor=grant_job_floor),npc_wallet=npc_wallet)

def assert_npc_economy(actual, *, npc_wallet):
    _wallet(npc_wallet)
    assert_zero_npc_resource_remainders(actual)
    assert 'npcEconomy' in actual and 'npcBattles' in actual
    _wallet(actual['npcEconomy'])
    assert exact_json(actual['npcEconomy'],npc_wallet), 'Exact independent wallet expected'
    assert exact_json(actual['npcBattles'],expected_npc_battles()), 'Exactly empty no-attack receipts expected'
    return True

def project_verified_npc_metadata(actual, *, npc_wallet):
    assert_npc_economy(actual,npc_wallet=npc_wallet)
    prior = deepcopy(actual); del prior['npcEconomy']; del prior['npcBattles']
    for planet in prior['planets']: del planet['npcResourceRemainder']
    return prior

def assert_zero_grant_metadata(actual, historical, *, grant_job_floor, npc_wallet):
    return assert_r11_zero_grant_metadata(project_verified_npc_metadata(actual,npc_wallet=npc_wallet),historical,grant_job_floor=grant_job_floor)

def project_verified_r13_metadata(actual, historical, *, grant_job_floor, npc_wallet):
    return project_verified_r11_metadata(project_verified_npc_metadata(actual,npc_wallet=npc_wallet),historical,grant_job_floor=grant_job_floor)
