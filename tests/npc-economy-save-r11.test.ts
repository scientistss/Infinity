import { describe, expect, it } from "vitest";
import historical from "./fixtures/npc-economy-r11.json";
import fixtureRaw from "./fixtures/npc-economy-r11.json?raw";
import { STORAGE_KEY } from "../src/game/content";
import { BACKUP_KEY, deserializeState, exportSave, importSave, serializeState, type KeyValueStore } from "../src/game/save";
import { SaveSession } from "../src/game/save-session";

const INITIAL = { model: "fixed-production-v1", elapsedSeconds: 0 };
const lift = (old: any) => ({ ...old, revision: 12, state: { ...old.state, npcEconomy: INITIAL } });
const partial = historical.rows.find(row => row.id === "partial-demolition-earned-grants")!;

describe("exact ca5 r11 source adoption", () => {
  it("pins actual historical serializer bytes and separates natural from synthetic sources", async () => {
    const { createHash } = await import("node:crypto" as string);
    const sha = (value: string) => createHash("sha256").update(value).digest("hex");
    expect(historical.sourceSha).toBe("ca5ef0c769856f2c4c8925e76a5c7d322822fe1b");
    expect(historical.sourceRevision).toBe(11); expect(historical.sourceVersion).toBe("0.6.18-alpha.1");
    expect(historical.sourceTree).toBe("3dd991030aa0d2448dc854f7f90de4fd1d18b7a4");
    expect(sha(fixtureRaw)).toBe("9846b224d3beb0195992ec875ef6543fab53017d42fc727b3fe1907a21c01147");
    expect(historical.originalNaturalSaveSha256).toBe("d456cbee26543071ce0a53b64f718dd707c59b4f47ccb5c07d10a292cd45aa2a");
    expect(historical.rows).toHaveLength(4);
    expect(historical.rows.filter(row => row.naturalProgression).map(row => row.id))
      .toEqual(["partial-demolition-earned-grants", "natural-r11-adoption"]);
    for (const row of historical.rows) {
      expect(row.generationMode).toBe("unmodified-r11-serializer-output");
      expect(row.synthetic).toBe(!row.naturalProgression);
      expect(sha(row.raw)).toBe(row.rawSha256); expect(new TextEncoder().encode(row.raw).length).toBe(row.rawBytes);
      expect(sha(row.oldReaderRaw)).toBe(row.oldReaderSha256);
      expect(JSON.parse(row.oldReaderRaw)).toEqual(row.oldReaderOutput);
      expect(JSON.parse(row.raw).revision).toBe(11);
      expect(JSON.parse(row.raw).state).not.toHaveProperty("npcEconomy");
    }
  });

  it.each(historical.rows)("adds only age zero to the exact complete old reader projection: $id", row => {
    const adopted = importSave(row.raw);
    expect(adopted).toEqual(lift(row.oldReaderOutput));
    expect(adopted.savedAt).toBe(row.oldReaderOutput.savedAt);
    expect(adopted.lastTickAt).toBe(row.oldReaderOutput.lastTickAt);
    expect(importSave(JSON.stringify(adopted))).toEqual(adopted);
    const state = deserializeState(adopted.state);
    expect(serializeState(state)).toEqual(adopted.state);
    expect(importSave(exportSave(state, adopted.savedAt, adopted.lastTickAt))).toEqual(adopted);
  });

  it("preserves the naturally paid partial job203 and earned grants without repricing or rebasing", () => {
    expect(partial.naturalProgression).toBe(true); expect(partial.synthetic).toBe(false);
    const state = importSave(partial.raw).state;
    expect(state.planets[0]!.demolition).toEqual({
      kind: "demolition", source: "manual", taskId: null, demolitionRuleVersion: 1,
      jobId: 203, building: "metal_storage", fromLevel: 9, toLevel: 8,
      paid: { metal: "128000", crystal: "0", deuterium: "0" },
      totalSeconds: 13.963636363636363, remainingSeconds: 8.963636363636363,
    });
    expect(state.planets[0]!.terraformerFields).toEqual({ base: 163, grantedLevels: 2 });
    expect(state.terraformerGrantJobFloor).toBe(89);
    expect(state.orders.nextJobId).toBe(204);
    expect(state.npcEconomy).toEqual(INITIAL);
    expect(state.totalTime).toBe(partial.oldReaderOutput.state.totalTime);
    expect(state.totalTime).not.toBe("0");
  });

  it.each([
    "slot", "floor", "ledger", "grant-capacity", "kind", "source", "task", "rule", "job-id", "level",
    "paid-key", "paid-fraction", "total", "remaining", "extra", "misplaced", "npc-smuggling",
  ])("does not repair damaged r11 %s while initializing NPC age", damage => {
    const edited = JSON.parse(partial.raw), planet = edited.state.planets[0], job = planet.demolition;
    if (damage === "slot") delete planet.demolition;
    if (damage === "floor") delete edited.state.terraformerGrantJobFloor;
    if (damage === "ledger") delete planet.terraformerFields;
    if (damage === "grant-capacity") planet.fieldsMax++;
    if (damage === "kind") job.kind = "build";
    if (damage === "source") job.source = "protocol";
    if (damage === "task") job.taskId = 1;
    if (damage === "rule") job.demolitionRuleVersion = 2;
    if (damage === "job-id") job.jobId = edited.state.orders.nextJobId;
    if (damage === "level") job.fromLevel++;
    if (damage === "paid-key") job.paid.extra = "0";
    if (damage === "paid-fraction") job.paid.metal = "0.5";
    if (damage === "total") job.totalSeconds = 0;
    if (damage === "remaining") job.remainingSeconds = job.totalSeconds + 1;
    if (damage === "extra") job.unknown = null;
    if (damage === "misplaced") edited.unknown = [{ demolition: null }];
    if (damage === "npc-smuggling") edited.unknown = [{ npcEconomy: null }];
    expect(() => importSave(JSON.stringify(edited))).toThrow();
  });

  it.each(historical.rows)("persists and reloads an upgrade at the original watermark: $id", row => {
    const values = new Map<string, string>([[STORAGE_KEY, row.raw]]);
    const store: KeyValueStore = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: key => { values.delete(key); },
    };
    const now = row.oldReaderOutput.lastTickAt, session = new SaveSession(store, now);
    expect(session.mode).toBe("ready"); expect(session.loaded.appliedSeconds).toBe(0);
    expect(serializeState(session.loaded.state)).toEqual(lift(row.oldReaderOutput).state);
    expect(values.get(BACKUP_KEY)).toBe(row.raw);
    const written = values.get(STORAGE_KEY)!, saved = importSave(written);
    expect({ ...saved, savedAt: row.oldReaderOutput.savedAt }).toEqual(lift(row.oldReaderOutput));
    const reloaded = new SaveSession(store, now);
    expect(reloaded.mode).toBe("ready"); expect(reloaded.loaded.appliedSeconds).toBe(0);
    expect(serializeState(reloaded.loaded.state)).toEqual(saved.state);
    expect(values.get(STORAGE_KEY)).toBe(written);
  });
});
