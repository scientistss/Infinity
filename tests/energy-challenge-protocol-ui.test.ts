import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { abandonEnergyChallenge, enterEnergyChallenge, quoteEnergyChallenge } from "../src/game/energy-challenge";
import { createInitialState } from "../src/game/state";
import { protocolSlotPermissions } from "../src/ui/protocol-safety";
const { readFileSync } = await import("node:fs" as string);

describe("energy challenge protocol permission projection", () => {
  function setup() {
    const state = createInitialState(0x12345678, 0x13579); state.lifetime.metal = big(1e8);
    state.research.levels.computer_tech = 2;
    state.protocols.slots[0]!.card = {id:"custom", enabled:true, trigger:{kind:"interval", seconds:5}, conditions:[], action:{kind:"prestige", minGain:1}};
    state.protocols.slots[1]!.card = {id:"auto_prestige", enabled:false, trigger:{kind:"interval", seconds:5}, conditions:[], action:{kind:"collect"}};
    const active = enterEnergyChallenge(state, quoteEnergyChallenge(state, "enter")).state;
    return {state, active};
  }
  it("disables enabling by action kind, leaving other automation/configuration/clear permissions intact", () => {
    const {state, active} = setup();
    expect(protocolSlotPermissions(active, 0, true)).toMatchObject({canToggle:false, canClear:true, canEdit:true});
    expect(protocolSlotPermissions(active, 1, true)).toEqual(protocolSlotPermissions(state, 1, true));
    expect(protocolSlotPermissions(active, 0, false)).toMatchObject({canToggle:false, canClear:false, canEdit:false});
  });
  it("preserves explicit off for a restrictive active enabled input rather than trapping it", () => {
    const {active} = setup(); active.protocols.slots[0]!.card!.enabled = true;
    expect(protocolSlotPermissions(active, 0, true).canToggle).toBe(true);
    active.protocols.slots[0]!.card!.enabled = false;
    expect(protocolSlotPermissions(active, 0, true).canToggle).toBe(false);
  });
  it("re-derives authority after abandon/import without auto-enabling any card", () => {
    const {active} = setup(), oldSlots = active.protocols.slots;
    const abandoned = abandonEnergyChallenge(active, quoteEnergyChallenge(active, "abandon")).state;
    expect(abandoned.protocols.slots).toBe(oldSlots);
    expect(protocolSlotPermissions(abandoned, 0, true).canToggle).toBe(true);
    expect(abandoned.protocols.slots[0]!.card!.enabled).toBe(false);
    expect(protocolSlotPermissions(active, 0, true).canToggle).toBe(false);
    const source = readFileSync(new URL("../src/ui/protocol-safety.ts", import.meta.url), "utf8") as string;
    expect(source).toContain("lastChallengeActive !== challengeActive");
    expect(source).toContain("lastChallengeActive = challengeActive");
    expect(source).toContain("slot.enabled.checked = card?.enabled ?? false");
  });
});
