# Historical scout snapshots and explicit combat rehearsal

Candidate specification for 0.6.22-alpha.1, v9/r14. Implementation and acceptance are in progress. This document does not establish a release or completed native verification. The design extends the existing paid scout and six-round orbital battle without new resource grants, combat rules, or automatic dispatch.

## 1. Recommended smallest useful scope

A real paid scout's future NPC arrival records exact typed historical information alongside the existing report text. The player opens that report, selects a currently stationed fleet at the currently selected player planet, explicitly runs three illustrative combat examples, and can explicitly fill an empty-cargo attack draft. The ordinary separate **付费出征** action remains the only path that dispatches and pays.

An already reviewed, unchanged fleet uses an explicit **重新核对出征条件** click to refresh its ordinary quote without re-running the combat examples. Frame observation never runs combat or repeatedly quotes the complete NPC ledger.

Proposed new project choices, not OGame rules:

- Save revision r14; snapshot model `npc-scout-snapshot-v1`.
- Three public deterministic examples, versioned seed group `npc-rehearsal-public-v1` with ordered literal seeds `[608135816, 2242054355, 320440878]` (hex `243f6a88`, `85a308d3`, `13198a2e`).
- Preserve the existing single-flight maximum of 1e12 per type, using the existing 13 flying types, current selected-origin landed stock, and safe-integer totals. Thus the structural sum is at most 13e12, still a safe integer. Reject an empty fleet and invalid/over-limit counts; never silently clamp. No new 1,000-ship ceiling is needed.
- Historical defender is only its observed LF/HF garrison, at most 8 LF plus 1 HF, with the already modeled zero combat technology. Existing coordinate-specific initial bounds still apply at save validation.
- Six rounds maximum, using the current `squadron-v1` kernel unchanged. No per-ship simulation, new combat model, adaptive sampling, optimizer, fleet enumeration, win-rate calculation, or background rerun.
- Stock-only v1: queued ships, formations' desired quantities, ships at other planets, and in-flight returns are not available inventory. Hypothetical future fleets/technology are explicitly deferred. Rehearsal count bounds match the existing actual-flight bounds rather than impose a smaller arbitrary cap.

The entry point is a retained NPC scout message with a nonnull typed snapshot. No entry from an unscouted galaxy row, live NPC projection, arbitrary coordinates, battle receipt, pasted text, or an old rounded report. Old scout reports retain their text and visibly say **没有可用的演练快照；需要新的付费侦察抵达**. Other ordinary messages retain their original short time-and-text presentation without an irrelevant rehearsal notice. Existing scout/attack routes remain usable independently.

## 2. Exact persistent shape and identity

Current r14 `FleetMessage` has exactly the own enumerable data fields `id`, `at`, `text`, `npcScoutSnapshot`. The last field is explicitly `null` unless that message was produced by a real NPC scout arrival in r14. `id`, `text`, and `at` retain their established length/type bounds. The message list remains at most 150 entries.

A nonnull `npcScoutSnapshot` has exactly:

```ts
interface NpcScoutSnapshotV1 {
  readonly model: "npc-scout-snapshot-v1";
  readonly fleetId: number;
  readonly originId: string;
  readonly target: Readonly<{ galaxy: number; system: number; position: number }>;
  readonly observedAt: string;
  readonly stock: readonly [metal: number, crystal: number, deuterium: number];
  readonly garrison: Readonly<{ light_fighter: number; heavy_fighter: number }>;
  readonly defenderTech: Readonly<{ weapons: 0; shields: 0; armour: 0 }>;
}
```

No live seed, RNG state, `nextFleetId`, launch authorization, wallet mark, battle result, payment receipt, or sample output is stored in it. Existing historical text owns the historical NPC name/faction; the structured target is authoritative for coordinates and the NPC identity is `npc-${coordinateKey(target)}`. Never parse the text to recover any structured field, including identity.

Rules:

- `fleetId` is a safe integer in `[1, Number.MAX_SAFE_INTEGER-1]`; the owning message ID is exactly `scout-${fleetId}`. Snapshot fleet IDs are unique and below current `nextFleetId`.
- `originId` is the existing 1–64 character ASCII planet-ID syntax. It is historical: it need not still name a current planet.
- Coordinates are strict plain data with galaxy 1–5, system 1–100, position 1–15. Save validation verifies deterministic NPC occupancy/initial-garrison bounds against the saved universe using a static identity check, not a mutable wallet projection. The rehearsal module receives no universe seed.
- `stock` contains the actual represented Number values from the single arrival projection, each finite and nonnegative, bounded by `[50000,30000,10000]`. Fractions and subnormal positive values survive unchanged; no `toFixed`, decimal text parsing, interpolation, production backfill, or epsilon adjustment. The only stock normalization is economic zero: copy `value === 0 ? 0 : value`, turning -0 into +0 exactly as JSON does. This is numeric resource-value preservation, not signed-zero bit identity. Apply that same zero rule in the direct new snapshot reader; leave the existing source wallet and old readers untouched.
- `garrison` is exactly both required named fields, safe nonnegative integers bounded by the coordinate's initial generation; historical losses are allowed. Do not compare it with today's surviving garrison or require a materialized site.
- `defenderTech` is an explicit copy of the modeled technology at observation, all three exactly zero under this snapshot version. Unknown models/nonzero technology are rejected rather than guessed.
- `observedAt` is the actual adopted `totalTime.toString()` at observation, not `Date.now`, NPC's rebased `now`, rounded message time, scheduled ETA, or scout dispatch time. Require a finite nonnegative canonical Decimal string, conservative maximum 100 characters, and no future time relative to canonical current totalTime. Canonical comparison must use the same representation for both sides.
- For **new typed arrivals only**, derive both stored `observedAt` and message list `at` from the same accepted canonical time string; clamp only the legacy numeric list label to 1e12. This avoids a binary-mantissa rehydration mismatch. Existing historical message `at` and text are untouched. The exact canonical timestamp is what the rehearsal displays.
- Deep-copy/freeze admitted snapshots and all nested data. Serialization revalidates them before JSON can erase or coerce invalid values.

If a live fleet shares a retained snapshot's ID, it must be the matching returning scout with the same origin and target. A retained attack receipt cannot share that ID. A snapshot does not require a live scout; a returning scout does not require a retained snapshot. No new ID is allocated by observation or simulation. These are structural consistency checks, not a cryptographic proof that an imported scout was paid: ordinary historical scouts have no permanent payment ledger. Runtime construction is restricted to the actual paid arrival path.

## 3. Observation boundary, old flights, and retention

Refactor the real scout-arrival branch to obtain identity, projected stock/garrison, observation time, typed snapshot, and the existing text from **one** detached arrival observation. Do not call a live observer from a message view or simulator. A text-only compatibility function may remain pure but must not append records or authorize a snapshot.

The only new snapshot-producing path is the existing uniquely identified, validated outbound scout resolving an actual due NPC arrival. Dispatch remains the existing paid `sendFleet`; arrival produces one message and changes the scout to returning. No new payment is collected for the snapshot. Read/render/export/import do not create it. Recall before arrival, empty/own coordinates, failed targets, dispatch, and return produce no typed observation.

Preserve existing scheduler order and tolerances. `tick` advances adopted totalTime/NPC production before the later fleet-arrival boundary. At a shared boundary, ordinary/scout arrivals run before orbital attack arrivals in the current code. A scout at that boundary therefore observes the pre-attack garrison/stock even when the attack has the smaller ID. Do not change that order incidentally. Repeated settlement is idempotent.

A valid old outbound scout migrated from any supported revision receives no snapshot during import. If it later reaches an NPC under r14, it creates a genuine new snapshot from the r14 actual arrival. An already-returning old scout never receives a retroactive one. A migrated due outbound scout may receive one on its normal first actual settlement, including existing zero/due-event behavior; migration itself never settles it. Preserve old duration, remaining time, elapsed time, ships, cargo, ID and paid fuel semantics.

Two explicitly tested historical reader boundaries need compatibility treatment. The old reader admits nonzero cargo on a scout although ordinary dispatch disallows it; arrival preserves and returns that cargo without changing new dispatch rules. If any retained message already uses the arriving scout's canonical `scout-ID`, preserve the existing history and append a deterministic unique suffixed **text-only** warning, then return normally. Check the complete at-most-150 message list and choose the first free suffix from a bounded 151-candidate set. Do not fabricate a typed snapshot from this ambiguous record. Ordinary FIFO trimming still applies, including when the conflicting old row was the oldest in a full list. In that edge the new precise observation is deliberately unavailable; a subsequent normal paid scout can create one. The archived underfull duplicate-ID case was already unreadable after old settlement; the full-list oldest case was previously readable after eviction. Keep those historical outcomes distinct.

The snapshot lives only inside its owning one of 150 ordinary messages. Normal FIFO message eviction deletes it. No secondary archive, pinned scout messages, new permanent NPC site, change to the 512-site limit, battle receipt, or coupling to the 60 terminal/64 unfinished attack-report quotas. Returning scouts can finish safely after their observations have been trimmed. If the selected message is evicted, close/retire its editable rehearsal and draft-filling capability immediately.

Curvature already preserves messages, totalTime, NPC economy, and nextFleetId. Preserve the typed snapshots as history too. Do not reset/rebase their time or infer a run number: existing `stats.launches` is not a strict safe integer identity. Curvature may delete the historical origin; that does not invalidate the history. Every previous UI reference, result, and fill capability retires immediately. Deliberately reopening a retained message in the currently adopted save may create a new review and new current-world draft after complete fresh validation. No saved generation is inferred from seed, IDs or launch counts; a previous unadopted world's DOM or callback can never fill a draft. A newly opened rehearsal uses the player's current selected origin after curvature, never the historical scout origin implicitly. Import/replacement adopts the imported world's history as a replacement, with no merge.

## 4. Save migration and fail-closed input boundary

Keep schema/version/storage key unchanged; add r14 explicitly to the supported revision list. Fix the snapshot introduction boundary at source revision <=13, independent of a later current output revision.

Before **any** source normalization, scan the untouched envelope (or raw state at direct boundaries) for the dedicated `npcScoutSnapshot` field and `npc-scout-snapshot-v1` model:

- r2–r13: reject the reserved field even when null, at every depth, and reject the reserved model in any location. Retagging a current snapshot-bearing export as an older revision must fail.
- r14: permit the field only as an own enumerable data property on a canonical numeric entry of `state.messages`; permit its model only in that message's nonnull snapshot. Reject misplaced markers, named array properties, array extras, symbols, accessors, inherited authority, cycles, and unknown snapshot fields/models. Do not run getters or coerce values.
- Validate new message objects and dense ordinary arrays exactly before `.map`/spread/JSON can omit invalid information. Check direct runtime serialization as well as JSON import. Bound processing to existing array/domain limits and avoid repeated scanning once per report.

Historical sequence:

1. r2–r5: retain the original ring/orders and subsequent existing migration chain.
2. r6–r7: retain source order-subformat-6 validation and subsequent existing template/formation migrations.
3. r8: preserve its real formation/order-subformat-8 boundary; add only the historically correct building-template step.
4. r9: retain the original terraformer migration and paid-job floor behavior.
5. r10: preserve original terraformer fields/floor; apply existing demolition-null and NPC migration steps.
6. r11: strictly preserve demolition/terraformer state; use existing age-zero NPC migration.
7. r12: require valid fixed-production-v1 source, copy its actual old resource snapshot to the r13 wallet baseline, and preserve the existing zero-remainder migration.
8. r13: require the complete current strict wallet/garrison, attack, remainder and crosslink reader; no new NPC migration or reconstruction.
9. Only after the appropriate old source has completely validated, add `npcScoutSnapshot:null` to each of its normalized messages. All old IDs, text, numeric list times, clocks, payment IDs, fleets and old-field projections remain the old reader's results. Do not fill snapshots from old rounded stock text, recorded names, current NPC stock or age.
10. Current r14 requires the explicit new slot on every message; missing slots and malformed snapshots fail. Do not silently treat incomplete r14 data as legacy.

The existing SaveSession remains the owner of exact raw backup, observed conflict checking, write/readback and adoption. A failed migration/import/reset leaves protected/exportable original progress. Do not claim an unreadable write left disk unchanged. Offline catch-up remains a separate, once-only, capped adoption after validation, not part of migration. Preserve genuine r2–r13 fixtures/producer hashes and actual old-reader refusal evidence; edited revision tags are negative attacks, never migration provenance.

## 5. Pure rehearsal contract and limits

Use a separate pure entry point, conceptually `rehearseNpcScout(snapshot, selectedShips, attackerTech, cargoFactor)`. It accepts detached validated data only, with strict exact keys. It must not import `GameState`, `npcAt`, `projectNpc`, the wallet settlement path, `sendFleet`, `npcBattleSeed`, `resolveNpcBattleCandidate`, external RNG, timers, or persistence. In particular, `resolveNpcBattleCandidate` is inappropriate because it derives the real battle seed from universe/fleet identity.

Canonicalize positive ship counts in catalogue order. For each of the three fixed public seeds, call `fightEncounter` with the copied observed defenders, copied current own technology, and that literal seed. Then use the current surviving-capacity and proportional-integer half-stock loot rules on the **historical** stock. Do not debit it. The seed is intentionally public and independent of all real identities; accidental numeric equality to some real seed is irrelevant and cannot be checked by looking up the real seed.

Freeze own weapons/shields/armour from the actually completed research levels at the explicit Run click. Do not predict queued research or use a due-but-unsettled head as a future completion. Freeze cargo factor from completed hyperspace technology at that click, using the exact current `1 + .05 * level` rule. Bound own levels to the established 0–1000 domain and cargo factor to one of those 1001 actual values. The actual attack still freezes cargo factor **at dispatch** and reads real combat technology **at arrival**. Explain both differences on the result.

No new research unlock is invented for reading/rehearsing paid intel. V1 can illustrate a stock fleet even when current attack prerequisites/fuel/slots are unavailable, but the view labels those constraints and Fill remains disabled until the complete ordinary latest attack quote passes. Current attack rules include weapons technology >=1 plus the actual building/research prerequisites of every selected ship; queued levels do not satisfy them. A valid engine alone is insufficient. Keep all fuel, capacity, stock, target occupancy, fleet-slot, 64-unfinished, 512-target, ID and remainder checks in the real quote/send path.

Zero cases:

- No attacking ships: invalid input, no samples.
- Observed empty garrison and nonempty attacker: valid zero-round undefended collection; unchanged attacking fleet, ordinary historical half-stock/capacity loot, no invented fight or random draws.
- Nonempty observed defender but zero stock: ordinary combat still runs; historical loot is zero.
- Draw, mutual destruction where supported, or attacker defeat: loot zero.
- Zero selected counts are normalized away only after unknown keys are rejected. Satellite/defense/unknown keys fail even when zero.

Work bounds: at most 13 attacker types, 2 defender types, 2 damage directions, 6 rounds, 3 seeds gives <=936 pair visits, <=270 type applications and <=36 local RNG draws, plus bounded validation/cargo work. Counts do not expand loops. With all 13 types at 1e12 each, conservative maximum aggregate damage using catalogue attack 200000, technology 1000, maximum RF multiplier 1250 and jitter 1.1 is approximately 3.61075e23; maximum aggregate hull is 1.1817e21. These remain finite. Loot is <=45,000 whole resource units. The calculation retains the actual kernel's binary64 approximation; no extra precision or per-ship fidelity is claimed. A separate 54-case study on exact 7554 covered all 13 types at counts 1/1000/1e12, tech 0/1000, both defended models and empty defenders, and all 3 seeds: finite damage, <=6 rounds, safe bounded survivors, unchanged inputs. Its maximum observed damage was about 4.2974e21. This existing-kernel numeric/immutability evidence is not an independent correctness oracle, new-feature execution or browser timing evidence; its recorded observations are design evidence, not a release gate.

Only one explicit Run request may be active. Disable duplicate submission, never queue multiple runs, and discard late results after any relevant context invalidation. No calculation on RAF, message rendering, opening other reports, input keystrokes, hidden panels, or background ticks. Cache at most the current one result in the current panel; no saved batch. Detailed rounds are formatted only on demand. A theoretical operation bound is not measured frame-time proof: later native profiling on the exact final candidate must show Run doesn't create a >=50ms main-thread long task on the agreed test machine, with the actual timing/environment reported; if it does, schedule one bounded cancellable task/worker without changing samples or letting queued work accumulate.

## 6. Player flow, labeling, and draft-only handoff

1. Existing paid probe path: earn/build prerequisites through real APIs. Probe construction requires shipyard 3, combustion 3 and espionage 2; espionage research requires lab 3. Scout has empty cargo, owned probe stock, quote/fuel/capacity and ordinary fleet constraints. Do not inject or gift units/tech/stock to demonstrate a natural route.
2. A real NPC arrival creates typed history. The message shows the unchanged report text plus observed time, model, exact values/details, and **历史情报，之后可能变化**. It is never called current intel.
3. Open that report's rehearsal. Show explicit current selected player planet, target coordinates, current available landed counts, and all 13 flying choices. Start the separate rehearsal selection at zero and speed100%; this opening does not touch the real fleet form. Bound each input by current landed stock and the existing 1e12/type flight limit, and check the safe total; refuse rather than truncate an oversized pasted selection. No automatic formation use or “max army” action in v1.
4. Explicit Run captures own tech/cargo and selected fleet. Report each sample's outcome, permanent losses/survivors, round count, and historical possible loaded loot. Label public sample numbers and seed-group version. Do not display a win percentage, probability, guaranteed safe fleet, “minimum/maximum possible,” expected profit, guaranteed loss ceiling, or future NPC stock.
5. Required wording: **三个固定公开种子的示例，不代表胜率、所有结果或损失/战利品保证。仅使用这份侦察抵达时的库存和驻军；真实抵达时情况可能不同。** Show captured own tech/cargo and warn that real dispatch/arrival may use newer levels. Numeric sample ranges, if later added, must be called only “these three examples,” never model bounds; v1 simply shows three rows.
6. Explicit **填入攻击草稿（空载）** declares beforehand that it will replace the draft's mission, target, all ship-count fields, speed and cargo with the reviewed selection and zero cargo. It does not change the selected player planet. Recheck retained report identity, live mounted controls, current origin, input fingerprint, generation, writable state, chosen stock, own tech/cargo equality, and the latest ordinary full quote. Failure makes no partial edits and shows the current reason. The quote uses current route/eligibility only, never supplies enemy stock to the simulator.
7. On success, set all 13 ship input values (including zero for unselected types), target, attack mission, reviewed speed, and zero cargo atomically in the DOM draft; clear stale formation/transport draft provenance; navigate to the existing fleet panel. Use a narrow authenticated controller handoff, not fabricated DOM dataset tokens or a saved report as send authority. Explicit fill can authorize this draft edit while still minting no send capability.
8. The fleet panel obtains a new latest quote and displays **仅已填入，尚未派遣或付款**. The existing separate **付费出征** click must mint/consume its own current one-shot `NpcActionAuthority` and call latest `quoteFlight`/`sendFleet`. Do not reuse a rehearsal result, fill token, former quote, selected sample or report ID as execution authority. Rehearsal never selects the real seed.

A failed prerequisite does not make the historical report disappear; it gives the exact existing attack requirement. No automatic shipyard order, research order, refuel, plan creation, attack dispatch, scouting repeat or resource grant belongs in this slice.

## 7. Staleness, cancellation and lifecycle

Always label enemy information historical, including at identical displayed timestamps: large Decimal totalTime can lose small increments, so age zero does not prove freshness. Display canonical observation time plus approximate elapsed game time only when representable; no TTL, freshness guarantee, live enemy comparison, automatic refresh or wall-clock substitution.

Ordinary time progression alone need not recalculate frozen samples. If completed own tech/cargo factor or selected-stock availability changes, keep the old result visibly tied to its captured inputs but disable Fill until an explicit new Run/review. Changes of selected quantities/speed invalidate the reviewed input result. Normal fuel/slot changes simply get a fresh quote at Fill and Send; no automatic simulation needed.

Close/Cancel/Back/tab navigation abandons the pending selection/result and edits no real fleet draft. Report replacement/eviction, another chosen report, selected-planet change, curvature/world adoption, successful import/reset, save-protection/conflict transition, DOM detach/removal/reinsert, or root replacement retires all pending Run/Fill callbacks and capabilities. Detect removal even if the same node is reinserted before a callback; cloned/rebuilt buttons and forged datasets never inherit authorization. Visibility hiding retires pending fills and cancels computation; returning requires the current panel to be deliberately reopened/reviewed. Exact world replacement must invalidate even when seed, planet IDs, launch count and report ID coincide.

Failed/cancelled imports and curvature confirmations must not mutate the current history or fleet form. They still must not leave an outstanding fill/send callback that can execute later without a new click. A protection transition invalidates immediately before paint; restoring writable status does not resurrect old authority. Historical report reading can remain available while protected, with edit/Run/Fill disabled.

Once a draft has been filled, later Run/Fill retirement must not claim the player paid. Existing attack control retirement handles origin/world/protection changes; a visibly retained draft can require a new explicit edit/route selection. Successful real send clears its selected ship draft and prevents repeat dispatch through a stale button, as today.

## 8. Independent tests and security matrix

The independently calculated eighteen Python design cases are embedded as fixed expected values in the rehearsal unit tests. They import no production combat or loot code to derive the expected values. Domain results remain separate from native, migration and performance evidence. Damage tolerance is fixed in advance at abs 1e-12 + rel 1e-14; counts, outcomes, rounds, seeds and loot are exact.

Six inputs × three fixed seeds cover:

- 4 LF vs 4 LF, own weapons 1: all draw after 6, attacker3/defender2, loot0.
- 4 LF vs 3 LF: first two draw after 6 (4/1 and3/1); third wins after 6 with 4 survivors and loot `[187,93,0]` from stock `[515,257.5,3]`, cargo factor 1.4. This is three examples, not a one-third win-rate estimate.
- 6 LF vs 2 LF: wins after 3, six survivors, full eligible `[257,128,1]`.
- Probe vs 8 LF + 1 HF: defeated after 1, no loot.
- One small cargo vs empty garrison: zero rounds, unchanged ship, stock `[5,3,1]` gives `[2,1,0]`.
- One small cargo + one cruiser vs 8 LF + 1 HF: mixed-type rapid fire, wins after 4 with cruiser surviving; cargo ship lost.

Before implementation acceptance, add the following independent gates:

| Area | Required cases and invariant |
| --- | --- |
| Creation | Paid natural dispatch/partial flight/reload/arrival/return; new snapshot appears once only at arrival. Recall before arrival, own/empty target, dispatch/view/export/import produce none. Single projection, exact stock fractions and garrison. |
| Timing | Whole versus partitioned fractional arrivals; shared scout/attack boundary in existing order; repeated due settlement; offline catch-up once; snapshot before/after real battle and re-scout; very large totalTime/list clamp; curvature preserves exact time/history. |
| Legacy | Genuine actual r2–r13 source exports and old-reader controls; r13 outbound old scout creates future snapshot; returning old scout stays null; old rounded text never becomes input. Full old-field projection equality with only explicit null slots added. r1/v8/foreign route/future revision still rejected. |
| Shape | Missing/null/undefined versus nonnull, unknown model, extra/missing fields, wrong types, prototypes/accessors/symbols, sparse/named arrays, cycle, wrong marker location, nonfinite/negative/overcap stock, signed-zero canonical policy (frozen source keeps -0, detached snapshot has +0, all nonzero/subnormal values survive), fractional/unsafe counts, forbidden zero-valued ship keys, invalid tech/cargo, malformed/future timestamp. Raw runtime and JSON attack cases. |
| Identity | Wrong `scout-ID`, duplicate observation IDs, fleetId>=nextFleetId, live outbound/wrong-mission/origin/target collision, attack receipt collision. Missing current historical origin and pruned scout fleet are valid. No site pin or current-garrison/stock equality requirement. |
| Independence | Deep-frozen full state equality around view/run/fill; same samples across different current NPC stocks/garrisons, universe/arcade seeds, nextFleetIds, time, message order and unrelated planets, while the selected historical payload/own captured inputs stay equal. Spies fail on live projection, real-seed helper, send/settlement, global RNG or persistence from rehearsal. |
| Arithmetic | Fixed oracle cases; 0/1/1000/1e12/1e12+1 per-type selection and full 13e12 safe total; all 13 types; tech 0/1000; exact allowed cargo factors; historical zero and fractional stock; one represented Number below half-integer/full cap; deterministic canonical ship insertion order; true empty-garrison zero rounds/no RNG. |
| UI authority | Trusted real click versus dataset/clone/forged action/replay; detach/reinsert; synchronous double click; cancel/close/back/tab/visibility; report trim/change; planet switch; same-ID import replacement; protection/conflict then recovery; curvature and failed/cancelled confirmations; stock or research completion between Run, Fill and Send. |
| Effects | Fill changes only the declared DOM draft; all game state including paid IDs, money, NPC sites, clocks, RNG and history stays unchanged. Only a separate real send changes state, using fresh quote and existing authority. No automatic tick/save/payment from result rendering. |
| Retention | 150 observations possible; 151st ordinary message trims exactly one, including an open observation; scout return works when its message is gone; 512 sites/64 unfinished/60 terminal capacities unaffected; no hidden secondary cache. |
| Accessibility/performance | Keyboard and narrow-screen flow, readable historical/source/quote reasons, focus stable during review, overflow tables scroll. Hidden panels perform no combat or round formatting. Upper-bound 13-type run has measured native duration / no >=50ms long task; repeated-click work stays bounded. |
| Storage transaction | Actual max-message typed fixtures, failed quota/backup/readback/corruption/full archive/conflict, exact raw export, no premature adoption, successful reimport and replay. Measure candidate serialization and all retained copies, not only a compact per-message calculation. |

Natural acceptance should extend the existing independently controlled paid route rather than inject ships or technology: genuine retained r10→actual r11/r12 source, paid combustion 3/probe, actual scout, weapons 1 through lab 4, paid LF construction, Run, cancel once, reopen/Run/Fill, separate real send, arrival/return/re-scout. Use the real current DOM's dense 13 ship fields and show that queued weapons 1 cannot authorize an attack. Synthetic edge fixtures must remain labeled synthetic. The existing natural route's source hashes and payment arithmetic are reused as provenance, not claimed as new r14 execution.

## 9. Payload and integration budget

Independent review of the agreed eight-field snapshot found:

- Explicit null adds 34 pretty-JSON or 24 compact ASCII characters/message: 5,100 or 3,600 for150.
- Using the installed Decimal's canonical 36-character timestamp bound, a maximum structured attachment adds 755 pretty or 445 compact characters/message: 113,250 or66,750 extra UTF-8 bytes at 150.
- A conservative 100-character admitted timestamp budget gives 819/509 per message: 122,850/76,350 at 150.
- On the independently captured 512-site/64-unfinished/60-terminal baseline, adding the canonical full 150 structured-message delta yields 416,606 UTF-8 bytes. Three full new copies plus one exact old source are approximately 1,553,174 UTF-8 bytes or3,049,772 UTF-16 storage bytes; the conservative 100-character case is 1,581,974/3,107,372.

These are one fixed baseline plus-field arithmetic, not a whole-product maximum, a new natural save, proof of storage quota headroom, or evidence that the exact final save passed strict validation. Existing message text permits 1000 UTF-16 code units including control characters, which can JSON-escape to 6000 ASCII characters. Including that admitted text bound and all 150 maximum-field typed messages raises the message-array contribution to 1,029,004 pretty characters (canonical 36-character time). On the same captured pressure rest, the total becomes 1,306,057 UTF-8 bytes / 2,611,970 UTF-16 bytes; three copies plus exact old source total 4,221,527 / 8,428,478. The 100-character time guard adds 9,600 per export. This remains a component-bound scenario, not a whole-product maximum: the baseline has no pinned returning receipts, other data varies, and current recovery may retain up to 64 append-only backups. Three copies is scenario accounting, not the backup-policy maximum. Do not shorten accepted old text or delete backups to make this feature fit a presumed quota. Do not lower the 150-report budget just because normal dispatch/return chatter usually leaves fewer. Native/storage tests need actual current fixtures and explicit backup-copy counts. These bounds must be checked again against the final candidate and actual native storage behavior.

Likely code surfaces, for this approved candidate after prior-slice acceptance: message/snapshot state+reader module; `fleet.ts` real-arrival observation and generic message null slot; `npc-attack.ts` generic message null slot; strict `space-save.ts`/`save.ts` gates and r14 metadata; message view + dedicated rehearsal model/controller; narrow draft handoff in `space-panel.ts`/`npc-attack-controls.ts`; world/protection invalidation in the existing host. Preserve `encounter-combat.ts`, real battle seed, paid send/settlement, wallet and underlying combat arithmetic. Any required change there is a separate design review, not a shortcut for previews.

## 10. Candidate verification and release boundary

The r14 candidate has two mandatory, independent jobs on the same exact Git commit. `verify` retains every existing native suite, all performance windows, and its 45-minute total limit. It adds the genuine pinned r13 source to save startup/import/failure comparisons and the strict r14 compatibility helpers. `scout-rehearsal` separately rebuilds that same source, checks actual r2–r13 reader behavior, continues the paid route, and runs the new native rehearsal/authority/four-width/storage/performance gate. Its bounded worker/supervisor use 900/910 seconds inside a 25-minute job.

The jobs use separate runners, browsers, storage contexts and artifact names. Both archive their exact source and build. Publication requires both jobs to complete successfully, complete rather than skipped native reports, matching source/fixture/build identities, and review of the actual evidence. A skipped job, a single successful job, an older commit's result or a partial suite cannot authorize publication. No `continue-on-error` or reduced observation window is used. Local generated reports with a dirty-source label are diagnostic evidence only; final natural/native acceptance requires a clean exact committed source.

The genuine historical fixture retains its actual generating Node/version and dependency-lock hash. Generation used the 0.6.21-alpha.1 lock; r14 changes only the two package release-label fields to 0.6.22-alpha.1. CI binds the original lock to exact cc19 source and proves every remaining lock field identical, rather than rewriting provenance as though it had been regenerated.
