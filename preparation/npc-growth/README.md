# Dormant NPC civilian-growth experiment

This directory prepares a small pure Number domain and independent arithmetic tests. It is not imported by the game. It does not enable NPC growth, change GameState or the save schema, dispatch ships, migrate old saves, or establish native/browser acceptance.

The fixed design is one mining annex: spend `[2000,1000,0]` only at a 60-adopted-second pass with at least `[4000,2000,0]` available; start `building-2`, then `building-1` on the next pass, then `complete` on the second subsequent pass. Completion changes only metal production from 5 to 6 per second. Caps remain `[50000,30000,10000]`; crystal/deuterium rates remain 2.5/1. There is no cancellation, refund, destruction, extra level, free fleet, garrison replacement or new combat mechanic.

## Checked API

`domain.mjs` exports only `MODEL`, `createState`, `validateState`, `inspect`, `materialize`, `advance`, and `debit`. All functions return:

- Success: `{ok:true,state,value}`.
- Refusal: `{ok:false,state,error:{code,message}}`. `state` is the exact original input object, unchanged. `createState` refusal has `state:null`.

Inputs are ordinary plain data objects and dense ordinary arrays, with exact known fields and finite bounded Numbers. Accessor fields, unknown fields and invalid counts are rejected. Successful changes use detached copies; no operation changes its input. A caller adopts a returned candidate explicitly. `validateState` and `inspect` return the original state reference with a detached observation where applicable.

| Function | Contract |
| --- | --- |
| `createState({seed=20261010,stock=[500,250,0]}={})` | Fresh fixture baseline, local time zero, saving phase, 60 seconds to first pass; `value:null`. Not a migration. |
| `validateState(state)` | Full strict state validation; `value:true`. No repair, normalization, projection, or advancement. |
| `inspect(state,key)` | `value:{key,stock,phase,spent,rates,garrison}`. Pure live fixture observation, not a paid scouting report. `spent` is the fixed committed cost derived from phase. |
| `materialize(state,key)` | Copy current shared baseline stock and phase to one permanent site with its deterministic initial garrison; `value:{created:boolean}`. Existing sites return unchanged. No replay or historical charge. A 513th site is refused. |
| `advance(state,seconds)` | Caller-authorized duration in `[0,28800]`, internally split at actual growth countdowns only; `value:{passes,actorVisits,trace}`. Zero duration does no work. |
| `debit(state,key,paid,garrison?)` | Explicit synthetic withdrawal from an existing site. Each paid amount must be a nonnegative safe integer no greater than `floor(currentStock/2)`. Optional survivor counts may only decrease. `value:{before,paid,after}`. Not combat or dispatch. |

A trace record is `{kind:'pay'|'complete',key,at,stock,paid}`. `at` is the actual Number sum of adopted segments within that call, for diagnostics only; it is not a persistent or authoritative global clock. Payment records contain after-payment stock and the fixed cost. Completion records contain the stock settled at the old rate and a zero current debit. Traces are returned to tests, not stored in domain state; each actor can produce at most one payment and one completion record.

State uses this exact shape:

```js
{
  model: 'npc-civilian-growth-preparation-v1',
  seed: 20261010,
  now: 0,
  growthPassRemaining: 60,
  baseline: { stock: [500, 250, 0], mark: 0, phase: 'saving' },
  sites: {
    // A materialized site adds garrison to the same actor shape:
    // '1:1:3': { stock: [...], mark: 0, phase: 'saving',
    //            garrison: { light_fighter: 8, heavy_fighter: 1 } }
  }
}
```

`now` is finite in `[0,12000)`, each `mark` is in `[0,now]`, and persisted `growthPassRemaining` is strictly positive and at most 60. A due growth pass is processed atomically before returning; an unprocessed zero countdown is rejected on readback. Each resource is between zero and its cap. Phases are exactly `saving`, `building-2`, `building-1`, `complete`. The seed is a uint32. Canonical occupied-coordinate keys and bounded garrisons use the frozen base hash. The fixture excludes its deterministic home but does not model player colonies; this is not a production target-membership adapter.

## Host boundary and Number authority

The host, not this API, owns permission to adopt elapsed time, its existing offline allowance, once-only adoption accounting, fleet identities and countdowns, paid dispatch, storage, and reload acceptance. Calling `advance` twice intentionally produces two advancements. There is no idempotence token, offline receipt, clock read, save format migration or claim that this API prevents a caller from adopting time twice.

The independent test driver chooses each actual segment as the minimum of its remaining authorized duration, `growthPassRemaining`, and its actual event countdowns. It calls `advance`, then observes due scouts in stable ID order, then applies synthetic attack debits in stable ID order. Only a countdown exactly equal to zero is due. A positive representable neighbor is pending; negative countdowns are invalid. The domain has no event queue and cannot know whether a caller has skipped an external event.

Production is lazy at the actor's current phase. Only a payment, completion, positive debit, or actual adopted segment-end relocation settles a stock anchor. An unaffordable pass does not move that actor's anchor. At completion the prior-rate stock is settled first, so faster metal production is never retroactive. Local wallet time is relocated at an adopted endpoint reaching 12000, never on a read and never by introducing an extra split at 12000. The scheduler cannot use whole-duration saturation to skip intermediate growth payments.

No EPS, ideal deadline, integer-time substitution, rounding, or `totalTime` subtraction decides stock, affordability, or event order. Arbitrary binary64 partitions can change stock, order and phase. The original prototype first failed an overstrong claim that 0.1-second partitioning would still buy both actors by nominal t900 in the coincident-raid scenario. It did not: an actual 720-second fleet countdown expired before the repeatedly reset growth countdown, allowing the raid before payment. The current tests must retain this counterexample rather than silently change the golden to claim partition equivalence. Same actual segment sequence with added pure reads and JSON roundtrips is the required stability claim.

For plain valid state, `JSON.stringify(state)` and `JSON.parse(text)` followed by `validateState` are pure readback. They never run a pass. Standard JSON converts negative zero to zero; both are numerically zero, but raw negative-zero bit identity is not a JSON claim. The API does not parse arbitrary text or provide a storage byte budget. Historical reports and old production save bytes are outside it.

## Independent checks

The companion oracle and tests are separate from the candidate module. The Fraction oracle does not import the candidate or game code. Exact integer/binary-exact examples establish fixed costs, phases, stock, admitted production and cap overflow. Independently calculated binary64 counterexamples establish represented-time limitations; Fraction arithmetic cannot replace Number authority for arbitrary decimal partitions.

```sh
python3 preparation/npc-growth/oracle.py --check
python3 preparation/npc-growth/test-oracle.py
node --test preparation/npc-growth/test-domain.mjs
```

These commands are standalone preparation checks, not additions to the production test command and not full CI. The isolated `npc-growth-preparation.yml` workflow runs only preparation scope checks and these independent Python/Node checks; a green result there is preparation evidence only, not application build, native acceptance or release evidence. Refer to [scope and acceptance](../../docs/NPC_CIVILIAN_GROWTH_PREPARATION.md) for what remains unimplemented. Test results must be reported for the exact candidate actually run; the presence of this directory alone is not a pass.
