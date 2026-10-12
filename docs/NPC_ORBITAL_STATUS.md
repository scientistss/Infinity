# NPC orbital and scout r14 status

**2026-10-12: released game e729c7f / 0.6.22-alpha.1 / v9/r14.**
The paid orbital battle, permanent losses, exact return settlement and compact
reports remain available. This release adds typed historical scout snapshots,
three explicit public-seed rehearsal examples and empty-cargo attack draft fill.
Only a separate ordinary paid dispatch launches an attack.

The exact [full CI 38205500857](https://github.com/scientistss/Infinity/actions/runs/38205500857)
passed `verify`, `verify-continuation`, `npc-orbital`, `scout-rehearsal` and
`required-gates` at 05:20:29 UTC. The release owner separately verified 536 source
files, all 62 application assets and release metadata; the 05:23 UTC publication
receipt was `succeeded`. The old site and player saves were not operated on.
See [r14 exact acceptance and publication](NPC_SCOUT_REHEARSAL_ACCEPTANCE.md).

## Verified scope

- 3,934 unit tests in 107 files; 4,806 native scout-rehearsal checks,
  6,593 orbital/report checks, 6,408 SaveSession checks and 1,944 render checks.
  The continuation reports contain 23 suites / 7,816 checks and 12 complete
  performance samples / six pairs. Counts at different layers are not additive.
- Actual paid scout arrival → historical message → three illustrative examples
  → explicit empty-cargo draft fill → separate paid attack → return and re-scout.
  Browser timestamps are controlled for natural routes; unmodified-clock probes
  and synthetic edge cases are identified separately. Four viewport widths do
  not mean four physical devices or long-term play.
- Probe construction requires shipyard 3, combustion 3 and espionage 2; ordinary
  attack still requires weapons 1 plus selected-ship prerequisites and a valid
  current quote. Queued research does not authorize dispatch.
- Rehearsal reads exact retained history, not current NPC stock. Three public
  seeds are examples, not win rates or guaranteed loot/loss bounds. Old rounded
  reports retain their text and require a new paid scout for a precise snapshot.
- Canonical main-wallet-plus-subunit rights, 512 persistent sites, 64 unfinished
  attacks and 60 terminal reports plus necessary pinned live reports remain.
  Blocked return preserves cargo and survivors; report viewing never claims loot.
- Same-lineage r2–r13 inputs pass their complete historical reader/migration
  chains, including each existing revision-specific lift. Only the final
  r13-to-r14 message change appends null scout slots; it does not rebuild the
  wallet or manufacture observations. Current r14 requires valid explicit slots.
  Unsupported early r13 missing rights still rejects safely.

NPC spending-led growth, retaliation and full planetary warfare remain open.
r15 is local unverified preparation, not a published release. Ordinary-load
samples do not remove the extreme-fleet stutter or establish a general speedup;
see [performance limits](NPC_SCOUT_REHEARSAL_ACCEPTANCE.md#性能与覆盖限制).

## Separate later promotion failure

The same-source [development-branch run 38207609186](https://github.com/scientistss/Infinity/actions/runs/38207609186)
failed `verify-continuation` and its aggregate at `actual rules: globalFull`;
its other three jobs succeeded. The failure report observed
`nativeCurrentRaw: null` and new-game status with the same source/fixture identity
as the green run. A null startup read is an inference from the synchronous
startup branch, not a directly captured initial read. The cause is unknown and
needs actual native diagnosis; it is not established as a race. Later suites and
performance did not run in that attempt and cannot borrow earlier results.
The successful release run and this failed promotion both retain their outcomes.

Contracts: [scout rehearsal](NPC_SCOUT_REHEARSAL.md),
[settlement](NPC_REMAINDER_SETTLEMENT.md),
[persistence](NPC_ORBITAL_ATTACK.md), [display](NPC_REPORT_DISPLAY.md).
The [r13 acceptance](NPC_ORBITAL_ACCEPTANCE.md) remains an immutable historical
record of 576e929 / 0.6.21-alpha.1 and its own release; it is not current r14 status.

## Historical failure retained; dock timing corrected

The earlier route remains failed. Its actual first attack-#8 dock event occurred
at `18.79955725610165` seconds, with metal `2910911.83616177`, crystal
`447710.15680556995` and deuterium `68825.7241553523` before credit. The preceding
transfer implementation rejected that event for precision and retained all
ships and cargo.

The previously described `19`-second state was a later observed blocked frame,
not the first dock boundary. At that later frame, metal `2911027.71225653` plus
loot `265` produced `2911292.7122565303` rather than the exact
`2911292.71225653`. Six ordinary one-second production retries stayed blocked
before a later balance happened to accept the transfer. Neither that accidental
retry nor the repaired candidate retrospectively makes the old route pass.
There is no epsilon allowance, discarded loot or compensating grant.
