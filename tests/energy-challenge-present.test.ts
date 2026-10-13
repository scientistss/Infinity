import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { enterEnergyChallenge, quoteEnergyChallenge } from "../src/game/energy-challenge";
import { createPlanet } from "../src/game/planet";
import { serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import { energyChallengeCardText, energyChallengeConfirmation, energyChallengeIntentKey, energyChallengeReview, energyChallengeScoreText, energyChallengeView } from "../src/ui/energy-challenge-present";

function eligible() {
  const state = createInitialState(0x12345678, 0x13579);
  state.lifetime.metal = big(1e8);
  return state;
}
describe("energy challenge read-only presentation", () => {
  it("shows a short locked condition without enrolling a new player", () => {
    const state = createInitialState(1, 2), before = serializeState(state), model = energyChallengeView(state);
    expect(model.phase).toBe("inactive"); expect(model.canEnter).toBe(false); expect(model.reason).toContain("普通曲率门槛");
    expect(model.summary).toContain("第 3 个"); expect(serializeState(state)).toEqual(before);
  });
  it("formats the fixed 10^-12 quantum exactly without rounding to a target", () => {
    expect(energyChallengeScoreText("0")).toBe("0");
    expect(energyChallengeScoreText("1")).toBe("0.000000000001");
    expect(energyChallengeScoreText("999999999999999999")).toBe("999,999.999999999999");
    expect(energyChallengeScoreText("1000000000000000000")).toBe("1,000,000");
  });
  it("identifies the actual mother independently of selected colony and renders exact paid/current levels", () => {
    const source = eligible(), state = enterEnergyChallenge(source, quoteEnergyChallenge(source, "enter")).state;
    state.planets[0]!.name = "母星 <img onerror=boom>";
    state.planets.push(createPlanet("colony")); state.activePlanetId = "colony";
    const model = energyChallengeView(state);
    expect(model.home).toContain("母星 <img onerror=boom>"); expect(model.home).toContain("[");
    expect(model.checklist).toHaveLength(4); expect(model.checklist.every(item => !item.complete)).toBe(true);
    expect(model.loadRule).toContain("读档继续");
    state.energyChallenge.active!.proofs.metal_mine = {jobId:1, targetLevel:1, source:"manual", taskId:null, paid:{metal:"60", crystal:"15", deuterium:"0"}};
    expect(energyChallengeView(state).checklist[0]!.complete).toBe(false);
    state.planets[0]!.buildings.metal_mine = 1;
    expect(energyChallengeView(state).checklist[0]!.complete).toBe(true);
  });
  it("reviews ordinary gains/losses plus only the concrete enabled prestige-action cards", () => {
    const state = eligible();
    state.protocols.slots[0]!.card = {id:"auto_build", enabled:true, trigger:{kind:"interval", seconds:3}, conditions:[], action:{kind:"prestige", minGain:7}};
    state.protocols.slots[1]!.card = {id:"auto_prestige", enabled:true, trigger:{kind:"interval", seconds:3}, conditions:[], action:{kind:"collect"}};
    state.protocols.slots[10]!.card = {id:"custom <b>", enabled:true, trigger:{kind:"interval", seconds:3}, conditions:[], action:{kind:"prestige", minGain:8}};
    const before = serializeState(state), quote = quoteEnergyChallenge(state, "enter");
    const preview = energyChallengeReview(state, quote), confirmation = energyChallengeConfirmation(state, "enter", quote);
    expect(preview.summary).toContain(quote.gain); expect(preview.summary).toContain("不退款");
    expect(confirmation).toContain("槽 1"); expect(confirmation).toContain("槽 11"); expect(confirmation).not.toContain("槽 2");
    expect(confirmation).toContain("保留参数配置"); expect(confirmation).toContain("普通");
    expect(confirmation).toContain("旧世界"); expect(confirmation).toContain("保存");
    expect(serializeState(state)).toEqual(before); expect(energyChallengeCardText(state, [])).toContain("没有");
  });
  it("explains abandon with no economy reset, refund or reward and no automatic re-enable", () => {
    const source = eligible(), state = enterEnergyChallenge(source, quoteEnergyChallenge(source, "enter")).state;
    const quote = quoteEnergyChallenge(state, "abandon"), preview = energyChallengeReview(state, quote);
    expect(preview.summary).toContain("不重置、不退款、无奖励");
    const confirmation = energyChallengeConfirmation(state, "abandon", quote);
    expect(confirmation).toContain("下次合法手动曲率"); expect(confirmation).toContain("自动曲率卡保持关闭");
  });
  it("bounds intent to attempt/phase/selected planet and ignores ordinary tick noise", () => {
    const state = eligible(), key = energyChallengeIntentKey(state);
    expect(energyChallengeIntentKey({...state, totalTime:big(100), lifetime:{...state.lifetime, metal:big(1e9)}})).toBe(key);
    expect(energyChallengeIntentKey({...state, activePlanetId:"elsewhere"})).not.toBe(key);
    expect(energyChallengeIntentKey({...state, energyChallenge:{...state.energyChallenge, nextAttemptId:2}})).not.toBe(key);
  });
});
