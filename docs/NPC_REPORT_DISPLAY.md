# Compact NPC orbital reports

The compact display is accepted and published in **0.6.21-alpha.1 / v9/r13**
at [576e929](https://github.com/scientistss/Infinity/commit/576e92910a07456a9b237b809e7c77d95203bbe5).
See [the exact acceptance record](NPC_ORBITAL_ACCEPTANCE.md) for its own completed
CI, immutable artifact, publication checkpoint and remaining scope. This display
increment builds on orbital source checkpoint
[`7554c662`](https://github.com/scientistss/Infinity/commit/7554c662e3ac1f27876a60d8aa706e5d4a4dcd52);
that earlier full run remained failed despite its completed orbital sub-suite.

## Reading a report

The closed summary shows the result, delivery status, route, total permanently
lost player ships, actual loaded resources, number of rounds and readable game
time. Empty-garrison collection is labelled explicitly and has zero rounds.
Opening the report retains the exact per-type losses, historical technology,
raw game timestamp and full-precision round table. This is game time, not a
wall-clock date or an estimate of how recently the battle happened.

The source name and coordinates are looked up from the current matching planet.
They are not a historical name snapshot. If that source has been abandoned, the
summary says it is unavailable; the receipt's original ID remains in the exact
details. Changing the selected planet cannot change the report's source.
Target coordinates, battle outcome, losses and loot always come from the saved
receipt, never from current NPC inventory or research.

`战后返航`, `入港受阻`, `已入港`, `全损`, `已丢弃` and an unverified delivery
state remain distinct. A blocked report explains that survivors and cargo are
retained and points to the existing fleet-page retry. Viewing or opening a
report never settles a battle, pays loot, recalls a fleet or retries a dock.
Historical loaded loot is not a promise that the same amount remains spendable
now: normal spending and the separate subunit-right rules still apply.

## Boundaries and acceptance

- Save v9/r13, combat, resource settlement, report limits and ownership rules
  are unchanged. There is no migration or new execution authority.
- Existing keyed rows preserve focus and disclosure state. Exact details and
  round cells remain lazily rendered and locally scrollable.
- Original artwork and protected UI files remain unchanged. A separate source
  seal binds exactly the presenter, panel and scoped space stylesheet, composed
  with the unchanged earlier orbital source seal.
- Native acceptance verified closed summaries and opened exact details at
  320, 390, 768 and 1440 pixels, alongside the complete existing battle,
  settlement, protection and persistence checks.
- The natural paid battle route remains unchanged. An additional explicitly
  synthetic UI fixture changes only a colony name and one delivered report's
  source ID. Real file import and lawful abandonment then test current-name and
  missing-source display. It is not a naturally fought colony battle or a
  native rename operation.
