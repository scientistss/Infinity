# NPC fixed-production save contract

This stage emits `infinity-original-p4` v9/r12 under the unchanged
`infinity.original-p4.save.v1` key. NPC resources are a fixed, bounded production
baseline. No spending, raids, transfers, rewards or mutable wallets are introduced.

## Current state

The one permitted location is `state.npcEconomy`, with exactly two own data fields:

```json
{ "model": "fixed-production-v1", "elapsedSeconds": 0 }
```

The age must be a finite number from 0 through 11,900 inclusive. Fractions are
allowed. Missing data, unknown models, extra fields, arrays, inherited fields,
accessors, non-finite values and misplaced dedicated `npcEconomy` markers fail
closed. The direct object reader examines descriptors without running getters;
cycles are rejected. Generic `model` and `elapsedSeconds` fields elsewhere are not
reserved NPC authority. Export validates the economy object before JSON encoding.

The loaded economy is a detached immutable object. Serialization does not query
NPCs, advance age, update historical messages or consume either random stream.

## Historical boundaries

Compatibility remains an explicit list of same-schema revisions r2 through r12.
These introduction boundaries are fixed facts, not comparisons against the
current output revision:

| Source | NPC age | Demolition | Terraformer grants |
| --- | --- | --- | --- |
| r2–r9 | Add age 0 | Add explicit null slots | Use the existing historical migration |
| r10 | Add age 0 | Add explicit null slots | Preserve ledger and original grant-job floor |
| r11 | Add age 0 | Preserve the complete existing strict slot | Preserve ledger and original grant-job floor |
| r12 | Require valid saved age | Require the existing strict slot | Require the existing strict ledger and floor |

Legacy envelopes are scanned for the dedicated `npcEconomy` marker before any
historical reader can normalize or ignore fields. Even null or an empty object is
rejected at every depth. Historical normalization belongs to the existing source
readers; the NPC migration does not infer age from `totalTime`, levels, names,
messages or wall-clock metadata. It does not rebase paid IDs, change payment
snapshots, allocate authority, rewrite RNG state or rebuild granted fields.

Future revisions and other schemas remain unsupported. The unrelated `sector`
route is not a historical source for this feature. The actual old r11 reader must
reject actual r12 exports; changing only an envelope's revision is not evidence
of a genuine historical serializer.

## Migration and elapsed time are separate

Pure import of a valid old envelope adds age 0 and preserves `savedAt` and
`lastTickAt`. A normal upgrade startup may then adopt the existing once-only,
capped offline interval since that watermark. Thus a long absence with the base
cap starts the new NPC model at 0 and adopts 7,200 seconds; it does not derive
25,810 seconds of NPC history from an old world's `totalTime`.

SaveSession remains the transactional owner. It retains exact source bytes,
verifies backup write/readback, rechecks the primary slot for observed conflicts,
and verifies the replacement before adopting offline progress. A failed upgrade
keeps readable old semantics frozen with NPC age 0 and the original export.
A successful but unreadable or corrupted primary write can have changed disk;
failure must not be reported as proof that disk was unchanged. Existing raw
backups are never rotated away to force migration through a full archive.

For current-revision startup, the normal adopted save persists its new wall-clock
watermark. Reopening the successfully persisted capped result cannot claim the
discarded portion of the same historical interval again.

Import adopts the imported world's age, universe and messages as a replacement.
It does not merge worlds or take the maximum of two ages. Failed import and failed
reset transactions must not replace live NPC state.

## Evidence and execution status

`tests/npc-economy-save.test.ts` covers the strict reader, exact roundtrips,
descriptor safety, misplaced fields and legacy-marker attacks. Attack derivatives
with edited revision tags are labeled attacks, not historical fixtures.

`tests/npc-economy-save-migration.test.ts` compares complete old-field projections
against retained actual r10-reader output and preserved r9 sources. It separately
uses the exact natural r10 envelope `demolition-origin-r10-save.json`, SHA-256
`d456cbee26543071ce0a53b64f718dd707c59b4f47ccb5c07d10a292cd45aa2a`, without
editing its clock or bytes. Its source provenance remains in
`tests/fixtures/demolition-origin-provenance.json`.

The same tests inject in-memory backup/primary quota failures, dropped writes,
read refusal, corrupt readback, full archives and cross-tab changes, and separate
age-zero migration from capped offline adoption and immediate repeated reloads.
`tests/npc-economy-save-r11.test.ts` additionally uses the four rows in
`tests/fixtures/npc-economy-r11.json`, produced by the unchanged actual r11 source
`ca5ef0c769856f2c4c8925e76a5c7d322822fe1b` (0.6.18-alpha.1). Its source tree is
`3dd991030aa0d2448dc854f7f90de4fd1d18b7a4`; its exact fixture SHA-256 is
`9846b224d3beb0195992ec875ef6543fab53017d42fc727b3fe1907a21c01147`.
The producer is `scripts/npc-economy-r11-fixture.mjs`; the fixture retains each raw
export, distinct old-reader canonical output, byte hashes and generation labels.

The four cases are a deterministic fresh constructor; a naturally paid partial
metal-storage demolition (job203, 128,000 metal, 8.963636363636363 seconds left)
with two earned terraformer grants and floor89; a labeled synthetic rich
paid/authorized state; and an unchanged natural r10 source adopted and exported
by the old r11 reader without ticking. The two natural cases are not labeled
synthetic, and the synthetic rich state is not represented as natural progression.
Every full old-field projection must survive with only NPC age 0 added; malformed
r11 demolition or ledger data is never repaired by NPC migration.

`tests/npc-economy-save-revision.test.ts` protects the fixed NPC introduction
boundary under an explicitly mocked future output revision. This structural test
does not replace the independent actual-ca5 old-reader refusal gate.

These are domain/storage-contract tests, not native-browser evidence. Test source
presence does not establish execution, full CI success or release completion; the
acceptance report must record those gates independently on the final source.
