# NPC orbital integration checkpoint

This branch is an unverified development checkpoint for the first NPC orbital
attack loop. It is not the published game and is not ready for playtest release.
The published fixed-production/scouting baseline is
[`eefc0706`](https://github.com/scientistss/Infinity/commit/eefc0706e8bc2ce39fbfd732ab9d3b67ac190d81),
version `0.6.19-alpha.1`, save revision 12.

## Connected candidate scope

The revision-13 candidate connects the prepared wallet, garrison, six-round
combat, integer loot and exact-transfer modules to paid fleet dispatch, arrival,
return, recall, persistence and a minimal UI. It retains permanent NPC losses,
fixed historical reports, explicit bounded capacities and protected save/import
handling. See [the persistence contract](NPC_ORBITAL_ATTACK.md).

These connections still need the complete current-schema regression suite and
native browser acceptance. Focused domain/persistence tests and independent
review do not establish that complete gate. No revision-13 deployment is approved.

## Confirmed ordinary-wallet usability blocker

A continuation of the genuine public revision-12 natural route reached a
three-round victory and loaded 265 metal, 132 crystal and 23 deuterium. At the
first return, the metal balance was `2911027.71225653`. The existing Decimal
addition produced `2911292.7122565303` instead of the exact canonical-decimal sum
`2911292.71225653`. The attack's strict credit check correctly refused the whole
landing and retained all ships and cargo, but this ordinary-sized reward cannot
reliably be delivered under that interface.

Six retries over ordinary one-second production updates remained blocked; a
later balance happened to accept the transfer. That is diagnostic evidence, not
an acceptable success criterion or a fix. The natural acceptance remains failed
at the first blocked ordinary return. A usable bounded exact-entitlement design
must be selected and separately tested before this feature can be released.
There is no epsilon allowance, silent extra resource grant, discarded loot or
successful-playtest claim in this checkpoint.

## Other verification state

Independent review reproduced raw attack-ship symbols, hidden fields and custom
prototypes being erased by normalization. The attack reader now checks those
raw shapes first; ordinary mission normalization remains unchanged. Repeated
rejection, unchanged input/source state and legal round-trip controls are kept
as regressions.

The current-schema fixture, native full-state replay and source-identity
contracts are being updated explicitly from r12 to r13. Historical source
fixtures and their prior failed/successful evidence are retained. A later formal
candidate must run the entire gate on its own exact commit and publish only its
verified immutable build.
