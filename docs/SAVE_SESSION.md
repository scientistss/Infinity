# SaveSession safety contract

The production entry point (`src/main.ts`) uses `src/game/save-session.ts` for every current-save load, save, export, import and reset. The original UI and artwork are unchanged.

## Supported formats

- Current storage key: `infinity.original-p4.save.v1`.
- Current schema: `infinity-original-p4`, version **9**, revision **3**.
- The only supported older import is **the same schema, version 9, revision 2**. Its existing universe, fleets and game progress are read using the existing r2 rules; `deepSpace` is initialized. An r2 file carrying r3-only deep-space data is rejected.
- v1/v5/v7/v8, later versions, r1/unknown revisions, other route schemas and malformed files are not converted or silently reset. They remain protected. Retaining original bytes does not imply compatibility.
- The previous site's `infinity.save.v1` is never used as the current game and is never overwritten. Its existing export control remains available.

## Open and protection

A missing key (`null`) permits a fresh game to save normally. An empty string is a corrupt save, not an absent save.

Current compatible saves load without a startup write. The live simulation applies the existing offline rules. An r2 upgrade is persisted only after its original bytes have a verified backup. If that upgrade cannot finish, the validated pre-catchup progress remains visible and frozen. The UI does not present an uncommitted migrated game as successful.

If a source cannot be read or parsed, the UI explicitly labels its initial display as a temporary placeholder. Protected/conflicted/unavailable sessions do not simulate time or accept gameplay mutations. Export, import, explicit reset and recovery notices remain accessible. Obtaining `window.localStorage` does not perform a write probe: a full quota must not hide readable saved progress.

A storage read, backup, current write or readback failure locks automatic writes. In-memory progress is not replaced by a failed import/reset. The original baseline bytes remain cached for the export button even if subsequent storage reads fail. A failed initial read cannot fabricate an original export; the UI reports that it is unavailable until reading works again.

A protected session may retry an explicitly requested valid import or reset after storage recovers. An observed competing-tab conflict instead requires exporting and reloading; neither autosave nor reset/import silently chooses one tab's progress over another's.

## Replacement order

Import, reset and r2 upgrade use this order:

1. Parse and validate the supported schema and state, then deserialize the candidate.
2. Serialize the candidate and validate the serialized output before touching storage.
3. Read the current key and compare its exact bytes to this session's expected baseline.
4. Preserve the old raw bytes in an unused backup slot, or reuse an identical backup, and verify the backup by reading it back.
5. Compare the current key to the expected baseline again.
6. Write the new current bytes, unless they already match, and read them back exactly.
7. Only after success may the UI replace its live state, dismiss old notices and report completion.

Reset never removes the current key and waits for an eventual autosave. It performs the same verified replacement immediately. Invalid imports do not write backups or change current state.

Ordinary saves validate serialization and perform the same current-slot comparisons and readback, without creating a new archive on every simulation save. A failed ordinary save freezes the current in-memory view and retains the last observed original in memory for export.

## Recovery backups

The legacy backup key is `infinity.original-p4.save.v1.backup`. Existing contents of that key are never rotated away. New distinct originals use `.backup.1` through `.backup.63`; an identical verified copy is reused. Archive writes are append-only and bounded. Full archive slots, quota failures or failed readback abort replacement. No automatic cleanup deletes the user's sole preserved copy.

A failed replacement may leave an additional verified backup. It may also have written the candidate if the subsequent readback failed. The UI must not claim that storage is unchanged in this latter case: it says the visible progress was not replaced, locks further writes, and exports the cached original. After exporting the original, reload to inspect what storage contains. Never blindly roll back a current key that another tab might now own.

## Cross-tab and asynchronous limits

Every write compares the current raw value against the session baseline, including before and after backup work. A `storage` event for the current key, or a clear event, rereads current storage and locks when it differs. Unrelated keys and equal values do not create a conflict. Rereading also avoids treating the stale payload of a queued storage event as current truth.

`localStorage` has no transactional compare-and-swap across keys or tabs. A second process can theoretically write between the final comparison and `setItem`, or after a successful readback. These checks are conservative, best-effort protection, not a claim of database-grade atomicity. They do not merge divergent games. Backup-slot allocation is similarly best-effort across concurrently executing processes; it never knowingly overwrites an occupied slot.

File imports capture a latest-intent token. A newer import/reset, any subsequent UI action, a successful save, or a detected conflict/failure retires the pending read. A stale file resolution or rejection cannot write storage or alter the UI. All file results carry a completion token, and the entry point checks that token again after `await` before displaying either a success or an error. This covers a newer action in the microtask interval between completing a file operation and the UI resuming.

## Compatibility APIs and verification

`importSave`, `exportSave`, `readSave`, `writeSave`, `clearSave`, `backupRawSave` and `loadGame` remain available to existing tests and non-production callers. `loadGame` now throws for every unsupported version instead of returning a fresh reset. Its r2 compatibility path preserves the raw source and returns the parsed projection, but does not replace the current key. `writeSave` and `clearSave` remain intentionally low-level, unguarded helpers; production must not use them directly.

`tests/save-session.test.ts` covers current/missing/corrupt/incompatible saves, r2 upgrade and quota failure, verified replacements, backup/current/read failures, uncertain writes, safe reset/retry, equal writes, competing tabs, bounded non-destructive backups and asynchronous file-intent races. Existing save/empire compatibility assertions were updated from implicit reset to protection. Native-browser verification lives in `scripts/browser-save-session.py`; it checks the actual production controls and browser storage rather than introducing product-only test hooks.
