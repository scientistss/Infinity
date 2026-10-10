/** Anonymous minimal fixture for genuinely hidden, native-clock Chrome tests.
 * No player data, clock overrides, queues, or autonomous prestige are involved.
 */
declare const process: { stdout: { write(text: string): void } };
import { STORAGE_KEY } from "../src/game/content";
import { tick } from "../src/game/logic";
import { deserializeState, exportSave, importSave } from "../src/game/save";
import { createInitialState } from "../src/game/state";

const epoch = 1_791_590_400_000;
const clone = (state: ReturnType<typeof createInitialState>) => deserializeState(importSave(exportSave(state, epoch)).state);
const initial = createInitialState(20261010, 20261010);
initial.planets[0]!.name = "匿名原生后台计时验收";
const state = clone(tick(clone(tick(initial, 0)), 0));
if (JSON.stringify(clone(state)) !== JSON.stringify(state) || JSON.stringify(tick(state, 0)) !== JSON.stringify(state)) {
  throw new Error("Native background fixture must survive strict readers and zero-time startup unchanged");
}
process.stdout.write(JSON.stringify({
  description: "Anonymous settled initial-state fixture; seed timestamps are replaced with native browser Date.now before navigation. Real HTTP, native Storage, native clocks, headed Chrome and two ordinary tabs are required.",
  key: STORAGE_KEY,
  save: JSON.parse(exportSave(state, epoch)),
}, null, 2));
