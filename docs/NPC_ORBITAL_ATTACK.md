# NPC orbital attack persistence (r13)

This document describes the integrated save boundary. Runtime scheduling and battle
settlement are separate; reading, exporting, or rendering a report never fights,
collects resources, lands ships, or advances the NPC clock.

## Persistent authority

- `npcEconomy` is `npc-wallet-garrison-v1`: actual finite Number inventories, a
  local `now` in `[0,12000)`, a baseline anchor, and permanent coordinate-keyed sites.
- At most 512 sites can ever be materialized in the current world. Defeated sites
  remain present, including zero garrisons. No history eviction removes a site.
- An attack fleet carries its full-ID deterministic seed, its launch cargo factor,
  and an explicit outbound or returning phase. Returning reasons distinguish
  battle, recall, and invalid targets. Blocked docks retain cargo and survivors.
- `npcBattles` stores bounded immutable battle snapshots. All live battle-return
  reports are pinned; up to 60 terminal reports are retained. At most 64 attack
  fleets can remain unfinished, including returning and blocked fleets.
- A report never creates a fleet or authorizes payment. Every returning report
  must match exactly one current battle-return fleet in both directions: ID,
  origin, target, seed, cargo factor, surviving ships, and all three cargo values.
- Terminal reports may name a historical origin that no longer exists. Their ID
  still reserves the allocator: `nextFleetId` exceeds every retained report ID.
- Current site garrisons cannot exceed any retained report's surviving defenders.
  This is a consistency check, not a signature or a way to recover pruned history.

## Reader checks

Current r13 requires both world fields and each planet's `npcResourceRemainder` explicitly. The three canonical subunit strings preserve exact NPC fuel/loot value outside the spendable wallet; see [the settlement contract](NPC_REMAINDER_SETTLEMENT.md). Earlier unreleased r13 checkpoints without this field are protected/exportable failures, not silently migrated saves. Data shapes reject accessors, symbols,
extra keys, sparse arrays, nonfinite stock/damage, noncanonical coordinates,
unrecognized ships, unsafe counts, invalid tech and cargo factors, excessive report
counts, duplicate identities, misplaced domain markers, and incomplete crosslinks.

Battle validation checks the existing six-round result shape: continuous round
numbers, finite nonnegative damage, monotonically decreasing totals, final totals,
per-type survival bounds, winner consistency, and explicit zero-round undefended
collection. It does not replay combat. Loot is recomputed only from the recorded
stock, surviving capacity, and fixed proportional integer allocation, with no RNG.

Runtime NPC fields and crosslinks are validated before JSON serialization so JSON
cannot conceal an invalid amount or omit an extra domain field. The wallet reader
returns detached snapshots without changing marks or production partitions.

## Historical migration

Revision acceptance remains explicit: v9/r2 through r13 on the original P4 schema.
The original r2–r11 migrations and source domain validators remain in their prior
order. All source revisions through r12 reject r13-exclusive names/models and the
attack mission before normalization. The r12 mission whitelist is frozen and does
not follow the expanded runtime mission list.

The r12 NPC source still requires exactly `model: fixed-production-v1` and finite
`elapsedSeconds` in `[0,11900]`. Only after all source domains validate is its actual
old snapshot copied into the new baseline, with `now=mark=0`, no sites and no reports.
Fractional values and `Number.MIN_VALUE` remain actual Number values. Neither old
wall time nor total game time backfills production, and initial assets are not
added again. r2–r11 first obtain their historically specified age-zero source.
After this validated historical chain, every source planet receives exactly zero
M/C/D remainders; legacy inputs carrying those new field names are rejected before
normalization. Current r13 round-trips preserve every exact remainder string.

SaveSession continues to own backup, conflict, write/readback and adoption ordering.
Migration itself applies no offline progress; the existing capped catch-up is
applied once from the original watermark after a validated candidate exists.

## Tests

`tests/npc-attack-save.test.ts` covers current shapes and crosslinks, malformed
runtime serialization, no battle replay, live pins and terminal pruning, exact r12
snapshot migration, reserved historical markers, and genuine r11 old-reader
projection preservation. Its r12 inputs are explicitly synthetic derivatives of
frozen genuine r11 outputs, not claimed natural-play r12 captures. Runtime and
native browser tests provide the separate playable-loop evidence.


## Landed stock and flight bounds

Attack alone separates the existing reader-valid landed-unit limit (`1e15` per
type/planet) from the existing single-flight limit (`1e12` per type). Per-type
empire totals, including every in-flight ship, must remain safe integers. A small
paid attack may therefore free a full port for a preserved blocked return;
retries still require the original unique fleet, report and owning planet.
Other missions retain their previous inventory guard.
