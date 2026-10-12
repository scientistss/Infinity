# NPC civilian growth: dormant preparation

Status: separate pure-domain preparation only, based on source `576e92910a07456a9b237b809e7c77d95203bbe5`. No game/runtime import, GameState field, production save-schema change, UI feature, storage migration, release, or native acceptance is supplied here. Existing source modules remain untouched. The r14 scouting and rehearsal gate remains independent.

## Fixed one-annex design

- Cost: 2000 metal and 1000 crystal; no deuterium.
- Decision pass: every 60 actually adopted Number seconds, sharing one persisted countdown.
- Start threshold: at least 4000 metal and 2000 crystal, preserving one cost's worth of reserve after the debit. Mere affordability of the cost is insufficient.
- Payment enters `building-2`; the next pass enters `building-1`; the second subsequent pass completes. Never complete on the payment pass.
- Complete metal rate: 6/second, previously 5. Crystal/deuterium remain 2.5/1 and resource caps remain 50000/30000/10000. Settle prior-rate production before changing phase.
- One annex only. No repeat purchases, cancellation, refunds, destruction, defenses, combat upgrades, free ships, garrison revival, retaliation, ranking or messages.

The model string freezes the phase/cost meaning. A future price, repeatable construction or destruction rule needs a separately designed model, not reinterpretation of a paid phase.

## Shared unseen representative and permanent sites

The baseline represents identical independent unobserved economies, not one purse that different coordinates compete to spend. It progresses without enumerating the universe. Reading an unseen coordinate is pure. Materialization copies current projected stock and phase once; it does not rerun past decisions or debit old costs a second time. New sites keep deterministic initial garrisons, while retained sites keep their own permanent casualties and independent stock.

At most 512 materialized sites are retained forever. The 513th is refused atomically, with the original state reference and data unchanged; no eviction, reset or dead-site replacement. Each growth pass visits one baseline plus the retained sites, at most 513 actors. From a fresh 60-second countdown, eight hours contains 480 passes and at most 246240 visits. An arbitrary valid state already near its next pass can contain 481 passes within the same duration; the implementation bounds the segment loop accordingly. This visit count is not a frame-time, browser-memory, or whole-save-quota measurement.

The standalone fixture copies the frozen coordinate/garrison hash and excludes the deterministic home. It contains no player-colony membership, paid attack dispatch or combat RNG. The `materialize` and `debit` operations are explicit experimental candidates, not authority to send fleets or withdraw from a player's wallet.

## Time, ordering, conservation and the failed stronger claim

Actual persisted finite Numbers govern local production time, stock anchors and the growth countdown. A positive adopted segment produces at the old phase, then executes an exactly due growth pass. The independent driver then handles exactly due scouts in stable ID order and exactly due synthetic attacks in stable ID order. Nominal ideal-time equality is not simultaneity. No epsilon joins nearly coincident events; a positive subnormal remains pending and a negative countdown is invalid.

Each investment and explicit bounded integer debit requires `after + paid === before` for every represented resource. Zero-cost deuterium is preserved. Production above the caps is overflow rather than an extra asset. Relocation happens only at an actual adopted segment endpoint reaching local time 12000; reads never relocate and the code never introduces an extra split at 12000.

The prototype's original assertion that decimal partitions would preserve both purchases by t900 failed. In the fresh scenario with a fleet countdown of 720, 0.1-second adoption expires that flight before growth pass 12 (the prototype measured growth at Number sum `720.0000000000881`). A raid can therefore leave that site still saving at nominal 900, while the genuinely coincident integer/event-boundary schedule pays before the raid and finishes construction. The difference is an intentional retained counterexample, not a repaired test or a claim of partition equivalence.

A second fixed binary64 counterexample starts `now = mark = 11999.9` and deuterium `1.799999999999636`. Actual segments `[0.1,0.1]` and `[0.2]` relocate at different endpoints and leave stock on opposite sides of deuterium's half-unit loot boundary. Independent binary64 evidence must be compared to actual candidate output. Fraction goldens are appropriate for the exact integer/binary-exact cases, not an authority to replace these Number results.

For a fixed actual adopted sequence, inserting observations or valid JSON roundtrips must leave the same economic result. JSON itself does not preserve the sign bit of negative zero; neither sign creates positive elapsed time. The pure API returns checked refusals and does not mutate inputs. Strict validation rejects non-finite/negative/out-of-bounds values, unknown fields, invalid phases, over-cap resources, invalid targets, inflated garrisons and excess retained sites. It validates a fixture state, not the provenance of an old game save.

## Fixed checkpoints

Fresh initial stock `[500,250,0]`, no raids, actual event-boundary advancement:

| Adopted seconds | Phase | Stock `[metal,crystal,deuterium]` | Committed cost |
| --- | --- | --- | --- |
| 720 | building-2 | `[2100,1050,720]` | `[2000,1000,0]` |
| 780 | building-1 | `[2400,1200,780]` | `[2000,1000,0]` |
| 840 | complete | `[2700,1350,840]` | `[2000,1000,0]` |
| 900 | complete | `[3060,1500,900]` | `[2000,1000,0]` |

Zero initial stock pays at 840 and completes at 960. A full-cap initial wallet pays at 60 and completes at 180; initial full-store production is overflow. A half-stock raid at 660 on a fresh materialized site delays payment to 1080 and completion to 1200. At a true t720 tie, a scout sees `[2100,1050,720]` after payment and before the synthetic raid. These are arithmetic fixtures, not real player combat or paid scouting evidence.

## Acceptance boundary

See [the module README](../preparation/npc-growth/README.md) for the exact small API and standalone tests. Independent fixtures may establish domain arithmetic, validation, atomic refusal, purity, bounded visits, permanent casualties and actual Number ordering. They do not establish production acceptance.

Still unimplemented/unverified here:

1. Host authority to adopt elapsed time and existing once-only offline accounting. Repeating `advance` intentionally advances again; there is no new receipt/token mechanism.
2. Fully validated old-save migration preserving stock/mark/now, fleets, reports, remainder rights and permanent garrisons before adding saving phases and a fresh countdown. No migration is executed here and no wall-time/totalTime backfill is authorized.
3. Production tick/event integration, actual paid dispatch, fuel, combat/loot transfer, return settlement, historical scout format and read-only rehearsal compatibility.
4. Storage byte budgets, quota failures, accepted old text and backups, strict crosslinks, native reload and multi-tab protections.
5. Actual native route: paid scout before growth, investment, reload while building, completion, paid re-scout, real attack/return and later re-scout proving no garrison revival or repeat payment.
6. Exact-source full CI, browser performance, release/deployment and long-term balance.

The isolated `npc-growth-preparation.yml` workflow checks the bounded preparation-only file scope and standalone oracle/domain tests. Its green status, if obtained for the exact candidate, establishes only that preparation evidence; it does not build or publish the application. No preparation-only test result clears these gates. No standalone file is imported from runtime; integrating any part is a separate change.
