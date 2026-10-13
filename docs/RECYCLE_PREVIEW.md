# Recycling estimate: read-only candidate

The arithmetic preparation checkpoint is `cafcdfdd140f4bcbf17e589e99f83f2d761f9e49`. This follow-on candidate adds a short, read-only current-condition estimate to the recycling mission, with details closed by default. Version `0.6.27-alpha.1` keeps save version 9 / revision 14. Full same-commit cloud acceptance is required before publication.

## Preserved settlement contract

The reference is public commit `6b985b88ec6b263a3eeb8f34252525383a9f110f`, `src/game/deep-space.ts`, Git blob `b5bca084100ad780aa99bf87ee1590074dd99bc1`.

- The fixed ship and resource iteration order, each Decimal operation, and current hyperspace factor remain unchanged.
- Available room is the lesser of unoccupied total cargo capacity and recycler capacity. Existing metal, crystal and deuterium all occupy space.
- Metal is the proportional amount rounded down. Crystal uses the remaining pickup amount, capped by available crystal and rounded down; it is not independently proportioned.
- The original missing-field return, remaining-field order, complete state/fleet construction, object ownership and summary text remain unchanged.
- Departure already pays the round-trip fuel under existing flight rules. Pickup does not deduct or reserve that fuel a second time.
- Returned `used` is a copied Decimal, so the pure calculation does not expose an input cargo object through Decimal's zero-add shortcut.

## Two distinct verification purposes

Independent literal examples establish the intended amounts: a 40,000 metal / 20,000 crystal field, hyperspace technology 2 and one recycler yields 14,666 metal / 7,334 crystal, leaving 25,334 / 12,666. Adding one large cargo ship and carrying 30,000 units leaves room for 13,000 / 6,500. Two fractional half-units produce no whole-unit pickup.

A separately retained historical function proves extraction equivalence, not correctness of the original economics. Its complete results and JSON order are compared with frozen input state/fleet, including unrelated resources, fleets, offers, messages, RNG and field order. The matrix has 560 deterministic combinations plus 70 per-ship cases and explicit boundary examples. The real dispatch-to-pickup-to-return API route separately verifies that fuel is charged once.

Historical local checks for the arithmetic-only checkpoint: all 4,490 unit tests in 116 files, the separate 28-test extraction suite, 140 existing deep-space/dashboard/transport tests, and TypeScript passed. These ran locally on Node 24.19.0; they are not native-browser or full release acceptance.

## Player-facing contract

Choose the existing recycling mission and target, then select ships and cargo normally. The short estimate shows the current expected metal and crystal pickup. The optional details show known debris, total cargo and recycling capacity, existing cargo use, available pickup room, and the remainder. Only already visible debris is read. Missing fields and invalid drafts are clearly unavailable rather than invented zero-value results.

The estimate uses the same current technology and cargo calculation as settlement. It is advisory: debris, fleets and technology may change before arrival. Dispatch remains a separate existing action and keeps its original validation and payment. Preview rendering creates no fleet, payment, queue entry, RNG change or new authority. Changing mission, world, source planet, protection state or leaving the panel retires stale displayed values. The original layout and art remain in place.

## Acceptance and limits

- Seven exact production paths are sealed against the accepted manual-payment source. All older source and art seals remain required.
- Unit tests cover literal amounts, full historical settlement equivalence, invalid and unknown fields, lifecycle retirement, frozen input ownership and repeated-render idempotence. The full local suite passed 4,592 tests in 118 files before final source/fixture acceptance; this is Node 24 evidence, not a cloud-browser result.
- The fixture starts from the existing explicitly funded, prerequisite-enabled, seed-selected pirate setup. Actual paid engine dispatch, outbound arrival, battle-created debris and survivor return generate the preview state. It is not a natural-new-game route, and those producer transitions are not browser payment evidence. The existing native deep-space payment and recycle suite remains mandatory.
- The new native suite checks current estimates with an independent old-formula oracle, cargo and speed changes, missing debris, invalid drafts, closed details, and 320/390/768/1440 widths using real input and scrolling. Normal read-only scenarios save and compare the complete state, RNG, queues, wallets, draft and browser storage. Genuine competing-tab protection checks retained storage, visible frozen UI and draft state; it does not claim to read private protected in-memory state through an unavailable export.
- The new suite is bounded to 240 seconds inside the unchanged 45-minute verify job. All seven existing jobs, old commands, performance windows and required aggregate remain mandatory. No eighth runner is added.
- Render regression keeps the original complete capture, validates the exact unique inactive preview subtree, and removes only that approved subtree from a copy. The benchmark validates the fixed non-recycle request and the uniquely positioned null preview field before comparing every other historical field.

Native and complete cloud outcomes must be reported with their actual final commit and run. A local build or a prepared script is not a publication result.
