# SaveSession safety contract

The production entry point (`src/main.ts`) uses `src/game/save-session.ts` for every current-save load, save, export, import and reset. The original UI and artwork are unchanged.

## Supported formats

- Current storage key: `infinity.original-p4.save.v1`.
- Current schema: `infinity-original-p4`, version **9**, revision **7**.
- Supported older imports are **the same schema, version 9, revisions 2, 3, 4, 5 and 6**. The r2 → r3 step preserves its universe, fleets and game progress while initializing `deepSpace`; r2 files carrying deep-space fields are rejected. The r3 → r4 step assigns stable ticket IDs in existing pending order, initializes the next ID and leaves finite automatic-reveal authorization empty. Both older revisions reject r4-only fields instead of silently discarding them.
- v1/v5/v7/v8, later versions, r1/unknown revisions, other route schemas and malformed files are not converted or silently reset. They remain protected. Retaining original bytes does not imply compatibility.
- The previous site's `infinity.save.v1` is never used as the current game and is never overwritten. Its existing export control remains available.

## Finite ring authorization in r4

`SAVE_REVISION` in `src/game/content.ts` is the canonical revision used by exports, migration handling, browser fixtures and release metadata. Current data must include `arcade.nextRunId`, `arcade.autoBatch` (explicitly `null` when absent) and an `id` on every pending run. Missing or malformed authorization is rejected, never erased or converted to a fresh allowance.

Pending IDs are positive, unique, strictly increasing safe integers, with a safe next counter greater than every pending or recorded batch ID. In-flight charge reservations must also fit in the remaining safe ID range. A finite batch snapshots a strictly increasing prefix of genuine pending ticket IDs, its source planet, the bet allocation, gross deuterium cap, cumulative spend and completed cursor. The cap and spend are finite nonnegative Decimal strings; spend cannot exceed the cap. Bet allocations, ID count, cursor and a maximum 240-character stop reason are validated strictly. A batch has at most 40 tickets, and an armed batch also respects the current stored-run limit.

An armed batch must have remaining tickets, an existing source planet and remaining snapshot IDs equal to the current pending prefix. Consumed snapshot IDs cannot remain pending. Stopped history may reference tickets or a planet that no longer exist and may survive a reduced storage limit. No history record grants new spending permission.

For r2/r3 migration, every saved `runLights` or `setBet` card is disabled before offline catch-up. Existing outcomes, charge receipts, RNG, bet amounts, economy and ticket order are retained. An old enabled unlimited card cannot authorize a finite batch or spend during migration. Reloading an r4 partial batch retains its original snapshot, source, cap, accumulated spend and cursor; normal authorized catch-up may advance that same remaining allowance, never replenish it. The old r3 reader rejects r4 instead of downgrading its authorization fields.

## Finite paid plans and identities in r5

The `orders` object is mandatory, including explicit task/job ID counters, the independent scheduler accumulator and an array of at most 100 tasks (at most 32 nonterminal). Issued IDs are positive safe integers below `Number.MAX_SAFE_INTEGER`; counters may equal that value as an exhausted sentinel. A stopped scheduler has a zero accumulator. Every paid building, research and shipyard entry has an immutable global `jobId` and explicit `taskId` (`null` for manual/protocol work). Shipyard entries also retain `orderedCount` and `paidPerUnit`; `count` continues to mean unfinished units.

Each plan-origin queue job and each nonterminal task receipt must match one-to-one, including kind, fixed payer/executor planet, building/research/unit target and ID. Pending building/research targets cannot exceed their authorized final level. Duplicate nonterminal goals are forbidden (research targets are global). Ship receipts retain original batch quantity and cumulative credit: quantity minus credited equals remaining queue count; total credited plus remaining cannot exceed the finite goal. Terminal history has no active receipt and may name a planet that has since disappeared. Paused tasks still require a real planet.

Budget, cumulative charged and refunded amounts are exact bounded decimal strings (at most 256 characters, 18 decimal places and `1e190`). Every resource obeys `0 <= refunded <= charged` and `charged - refunded <= budget`. A real active queue's refundable remaining liability must fit within that exact net commitment. Wallet transfers still use the existing large-number implementation, with a disclosed relative agreement tolerance of `1e-9`; the exact ledger does not convert wallet rounding dust into extra charge or refund authority.

The r4 → r5 step adds an empty plan list and assigns existing paid-job IDs deterministically: planets in saved order, building queue then shipyard queue per planet, followed by global research. It preserves saved costs, timers, payer IDs, queue progress and economy. Existing ship batches get `orderedCount = count` with catalog unit-price snapshots, so migration never invents historical unit completion. Existing r4 ring tickets and finite authorization remain intact. Only r2/r3 migrations disable the legacy ring cards, as above. Every older revision rejects r5-only orders, identities and snapshot fields rather than interpreting them as fresh permission or silently downgrading them.

Native browser migration fixtures are generated from the actual verified r2/r3/r4/r5/r6 source serializers, not by relabeling a current file. The generator accepts their absolute source directories in revision order; the browser suite checks all five migrations, armed r4 authority, exact backups and frozen views for injected migration failures. All fixtures are synthetic.

## Single-source transport authority in r6

Revision 6 is an additive authorization boundary. Every task has mandatory `transport` and `currentWork` fields, every fleet has mandatory `orderTransport`, and orders have a mandatory `nextWorkId`. Absence is rejected; no missing field becomes a fresh allowance. Local plans and ordinary fleets explicitly store `null`. Authorization, fixed work, receipt manifests, coordinates and outcomes are copied independently on serialization. New nested objects reject unknown fields, phase/outcome values, invalid integers, and amounts that lose exact value through the wallet representation.

A transport authorization fixes one donor distinct from the executor, one flyable ship kind and count, a speed in 10-percent steps, 1–100 trips and a gross cargo cap for each resource. The authorization itself does not debit resources. Trips keep immutable real fleet/work IDs, original target ID and coordinates, cargo, fuel and locked duration. History is bounded to 256 receipts across all retained tasks; a terminal task does not bypass that bound. Issued work and fleet IDs remain below their monotonically increasing counters; exhausted safe-integer counters are allowed only as unissued sentinels.

Work ownership is global across current work and all retained trip history. Only the same task's current work and its one trip may share a work ID. A task can retain at most one outbound or returning trip, including a blocked return. It cannot open another work while that ship is still active. `shipmentFleetId` must name the one receipt for the current work, and cannot be cleared to replenish authorization after recall, refund, reload or delivery.

Pending work has no paid job, and its exact reservation equals the frozen remaining price. Ship work retains its original quantity, unit-price snapshot and completed-unit baseline through cancellation and re-payment. Paid work must match its actual queue, fixed goal, payer, original price, quantity and completed watermark. A transport work cannot pay while its ship is outbound, or while an undelivered ship is still returning. A delivered returning ship may coexist with its real paid queue. Building and research work cannot skip an unfinished predecessor or be a paid successor behind a same-goal queue entry.

Every active trip and tagged real fleet match one-to-one. Mission, donor, exact ship kind/count, target ID and coordinates, locked duration, phase and cargo are checked. Outbound ships retain the full manifest. A delivered return has exactly zero cargo; an undelivered return retains exactly its original manifest. Logs, a returning Boolean and an empty cargo hold are never substituted for an explicit outcome. Settled or prestige-retired receipts cannot retain a real fleet. Terminal tasks retain no paid/current work and cannot remain outbound, but may retain a real returning ship. A missing executor is allowed in an active return only for cancelled `target-invalid` history; live authorizations require both planets.

The reader verifies `net + reserved <= budget`, nonrefundable fuel is covered by net deuterium, remaining real queue refund liability fits after subtracting that fuel, gross cargo stays within each cap, and trips stay within the fixed count. Exact additions fail closed at the existing `1e190`, 18-decimal-place and 256-character limits. Returning cargo and fuel are never refunded by migration. Historical fuel and duration are not recomputed from current research or stocks.

`dockBlocked` is explicit returning receipt state at zero remaining time. The original ship and cargo remain present and a running owner must already be paused; terminal owners stay terminal. Reload does not fabricate return, unload, dispatch or payment. The normal simulation freezes blocked-leg elapsed time and excludes the blocked event until the user retries that same real fleet's landing.

The r5 → r6 migration first rejects any new transport/work/owner fields, even null, and validates the old exact task schema. It preserves all real r5 plan ledgers, paid identities, completed watermarks, costs, timers, fleet cargo and existing ring authority. It adds only `transport = null`, `currentWork = null`, `nextWorkId = 1` and fleet `orderTransport = null`. Revisions 2–4 retain their existing migration chain before the same additive step. Their old paid jobs and fleets are never inferred to authorize transport. All older revisions reject smuggled r6 fields instead of silently dropping them.

Synthetic unit boundary fixtures are separate from real historical-source proof. `scripts/save-session-fixture.ts` requires five absolute verified r2, r3, r4, r5 and r6 source directories. It produces actual source-exported legacy files, an armed r4 file, and a real r5 paid local plan plus ordinary transport. The native browser suite covers all five migrations and byte-exact backup/failure behavior, including preserving readable r5 paid work when a backup fails. `scripts/check-order-migration.mjs` independently compares complete old-schema projections from real old serializers and queue primitives. The old r5 reader must reject r6 rather than strip its authority.

## Pure research intent in r7

Revision 7 adds a mandatory `researchTemplates = { nextTemplateId, templates }` library and leaves the orders subformat at revision 6. A library contains at most 32 templates. Each template contains exactly `id`, `revision`, `name` and `goals`; each goal contains exactly `tech` and `targetLevel`. No payer, budget, charge/refund ledger, queue receipt, task/run identity, status or transport authority may be saved in a template. Unknown object fields are rejected rather than stripped. Serialization validates and independently copies the library, each template, each goal array and each goal.

IDs are unique positive safe integers strictly below `nextTemplateId` and below `Number.MAX_SAFE_INTEGER`. The next counter may equal that maximum as an exhausted sentinel. Revisions are positive safe integers; an exhausted revision remains readable but cannot be edited again. Names are trimmed, nonempty, contain at most 64 Unicode code points and reject C0/C1 controls. Duplicate names are allowed. Each template contains 1–16 distinct known technologies in canonical catalog order, with absolute integer goals from 1 to 1000. The reader and domain actions use the same name/goal validation.

The r6 → r7 branch adds only an empty library. It explicitly bypasses the older transport migration so original transport authorization, pending work, reservations, real outbound/returning fleets, receipts, paid research, paused plans, economic values and timers remain intact. Revisions 2–5 follow their existing migration chain and then receive the same empty library. Before migration, all r2–r6 sources reject even null/empty `researchTemplates` or `nextTemplateId` fields, including nested smuggling. Generic old `id`, `revision` and `name` fields are not prohibited.

Upgrade notices distinguish their source: r6 preserves existing plans and transport; r5 preserves plans while transport starts empty; r2–r4 start with empty plans and transport. Every source starts with empty research intent. Migration and catch-up do not apply a template or create new authorization. Normal existing paid work or previously authorized plans still follow the unchanged simulation rules.

Real-history verification archives r6 commit `bc6f5a475336dca1bb02d4f1061ee01ba9c5d9c4`. `scripts/legacy-r6-fixture.ts` uses only that historical source's creation, order pass, research payment, pause, fleet advance, recall and serializer APIs to produce anonymous synthetic outbound and returning scenarios. The deterministic migration check compares the complete old state after removing only the new library. The actual old r6 reader must reject a current r7 file containing a nonempty library. The preceding r5-reader/r6-file guard remains separately exercised with archived code.

The native HTTP suite adds source-r6 migration, exact backups, full prior-state projection comparison, paid-research/transport retention, and cross-tab conflicts. Its r6 no-catch-up cases explicitly control only the wall-clock envelope to isolate migration; fault cases retain native Storage backing and explicitly inject backup/current write throw/drop or post-write read denial. A current write followed by readback denial is treated as uncertain: the candidate may be on disk, the readable pre-catch-up source stays frozen, and export returns cached source bytes without a rollback claim. These checks supplement the unchanged earlier failure matrix. They are verification specifications; a run is successful only when its report says so.

Imported r7 libraries replace the current library rather than merge IDs. A verified reset creates an empty library. Existing finite orders and paid work are separate from templates; editing or deleting intent cannot rewrite their authorization. SaveSession's current comparison, backup, verification and asynchronous intent rules are unchanged.

## Open and protection

A missing key (`null`) permits a fresh game to save normally. An empty string is a corrupt save, not an absent save.

Current compatible saves load without a startup write. The live simulation applies the existing offline rules. An r2/r3/r4/r5/r6 upgrade is persisted only after its original bytes have a verified backup. If that upgrade cannot finish, the validated pre-catchup progress remains visible and frozen. The UI does not present an uncommitted migrated game as successful.

If a source cannot be read or parsed, the UI explicitly labels its initial display as a temporary placeholder. Protected/conflicted/unavailable sessions do not simulate time or accept gameplay mutations. Export, import, explicit reset and recovery notices remain accessible. Obtaining `window.localStorage` does not perform a write probe: a full quota must not hide readable saved progress.

A storage read, backup, current write or readback failure locks automatic writes. In-memory progress is not replaced by a failed import/reset. The original baseline bytes remain cached for the export button even if subsequent storage reads fail. A failed initial read cannot fabricate an original export; the UI reports that it is unavailable until reading works again.

A protected session may retry an explicitly requested valid import or reset after storage recovers. An observed competing-tab conflict instead requires exporting and reloading; neither autosave nor reset/import silently chooses one tab's progress over another's.

## Replacement order

Import, reset and r2/r3/r4/r5/r6 upgrade use this order:

1. Parse and validate the supported schema and state, then deserialize the candidate.
2. Serialize the candidate and validate the serialized output before touching storage.
3. Read the current key and compare its exact bytes to this session's expected baseline.
4. Preserve the old raw bytes in an unused backup slot, or reuse an identical backup, and verify the backup by reading it back.
5. Compare the current key to the expected baseline again.
6. Write the new current bytes, unless they already match, and read them back exactly.
7. Only after success may the UI replace its live state, dismiss old notices and report completion.

Reset never removes the current key or waits for an eventual autosave. It performs the same verified replacement immediately. Invalid imports do not write backups or change current state.

Ordinary saves validate serialization and perform the same current-slot comparisons and readback, without creating a new archive on every simulation save. A failed ordinary save freezes the current in-memory view and retains the last observed original in memory for export.

## Recovery backups

The legacy backup key is `infinity.original-p4.save.v1.backup`. Existing contents of that key are never rotated away. New distinct originals use `.backup.1` through `.backup.63`; an identical verified copy is reused. Archive writes are append-only and bounded. Full archive slots, quota failures or failed readback abort replacement. No automatic cleanup deletes the user's sole preserved copy.

A failed replacement may leave an additional verified backup. It may also have written the candidate if the subsequent readback failed. The UI must not claim that storage is unchanged in this latter case: it says the visible progress was not replaced, locks further writes, and exports the cached original. After exporting the original, reload to inspect what storage contains. Never blindly roll back a current key that another tab might now own.

## Cross-tab and asynchronous limits

Every write compares the current raw value against the session baseline, including before and after backup work. A `storage` event for the current key, or a clear event, rereads current storage and locks when it differs. Unrelated keys and equal values do not create a conflict. Rereading also avoids treating the stale payload of a queued storage event as current truth.

`localStorage` has no transactional compare-and-swap across keys or tabs. A second process can theoretically write between the final comparison and `setItem`, or after a successful readback. These checks are conservative, best-effort protection, not a claim of database-grade atomicity. They do not merge divergent games. Backup-slot allocation is similarly best-effort across concurrently executing processes; it never knowingly overwrites an occupied slot.

File imports capture a latest-intent token. A newer import/reset, any subsequent UI action, a successful save, or a detected conflict/failure retires the pending read. A stale file resolution or rejection cannot write storage or alter the UI. All file results carry a completion token, and the entry point checks that token again after `await` before displaying either a success or an error. This covers a newer action in the microtask interval between completing a file operation and the UI resuming.

## Compatibility APIs and verification

`importSave`, `exportSave`, `readSave`, `writeSave`, `clearSave`, `backupRawSave` and `loadGame` remain available to existing tests and non-production callers. `loadGame` now throws for every unsupported version instead of returning a fresh reset. Its r2/r3/r4/r5/r6 compatibility path preserves the exact raw source and returns the parsed projection, but does not replace the current key. `writeSave` and `clearSave` remain intentionally low-level, unguarded helpers; production must not use them directly.

`tests/research-templates-save.test.ts` covers strict r7 shape, bounded goals, name/ID boundaries, deep-copy isolation, forbidden execution fields, additive empty-library migration, old-revision smuggling, library replacement and reset. `tests/transport-save.test.ts` covers strict transport structure, historical ownership, pending/paid reservations, actual fleet phases, blocked returns, exact limits and additive r5 migration. `tests/save-session.test.ts` covers current/missing/corrupt/incompatible saves, r2/r3/r4/r5/r6 upgrade, disabled legacy automation, partial-batch reload and migration write/read/quota failures, verified replacements, backup/current/read failures, uncertain writes, safe reset/retry, equal writes, competing tabs, bounded non-destructive backups and asynchronous file-intent races. Existing save/empire compatibility assertions were updated from implicit reset to protection. Native-browser verification lives in `scripts/browser-save-session.py`; it checks the actual production controls and browser storage rather than introducing product-only test hooks.
