/** Verify that the preceding released reader refuses new safety metadata. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exportSave } from "../src/game/save.ts";
import { createInitialState } from "../src/game/state.ts";
import { SAVE_REVISION } from "../src/game/content.ts";

const root = process.argv[2];
if (!root) throw Error("Provide the verified preceding source directory");
const previous = await import(pathToFileURL(resolve(root, "src/game/save.ts")).href);
const previousContent = await import(pathToFileURL(resolve(root, "src/game/content.ts")).href);
assert.equal(SAVE_REVISION, 9, "This boundary protects r9 building template intentions");
assert.equal(previousContent.SAVE_REVISION, 8, "Guard must load the actual preceding r8 reader");
assert.equal(previousContent.SAVE_VERSION, 9);
const state = createInitialState(42);
state.researchTemplates = { nextTemplateId: 2, templates: [
  { id: 1, revision: 1, name: "Synthetic retained intent", goals: [{ tech: "energy_tech", targetLevel: 3 }] },
] };
state.formations = { nextFormationId: 2, entries: [
  { id: 1, revision: 1, name: "Synthetic retained fleet design", ships: { small_cargo: 4, light_fighter: 8 } },
] };
state.buildingTemplates = { nextTemplateId: 2, templates: [
  { id: 1, revision: 1, name: "Synthetic retained building intent", goals: [{ building: "metal_mine", targetLevel: 3 }] },
] };
const candidate = exportSave(state, 1_000_000);
assert.throws(() => previous.importSave(candidate), /修订不兼容/, "Old readers must reject rather than discard new authority fields");
console.log(JSON.stringify({ currentRevision: SAVE_REVISION, previousReader: `v${previousContent.SAVE_VERSION}/r${previousContent.SAVE_REVISION}`, result: "rejected as required" }));
