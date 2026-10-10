/** Verify that the preceding released reader refuses new safety metadata. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exportSave } from "../src/game/save.ts";
import { createInitialState } from "../src/game/state.ts";
import { SAVE_REVISION } from "../src/game/content.ts";

const root = process.argv[2];
if (!root) throw Error("Provide the verified pre-r4 source directory");
const previous = await import(pathToFileURL(resolve(root, "src/game/save.ts")).href);
const candidate = exportSave(createInitialState(42), 1_000_000);
assert.throws(() => previous.importSave(candidate), /修订不兼容/, "Old readers must reject rather than discard new authority fields");
console.log(JSON.stringify({ currentRevision: SAVE_REVISION, previousReader: "v9/r3", result: "rejected as required" }));
