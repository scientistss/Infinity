import { afterEach, describe, expect, it, vi } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { emptyCargo, quoteFlight, type FleetRequest } from "../src/game/fleet";
import { createInitialState, createPlanet } from "../src/game/state";
import * as deep from "../src/ui/deep-present";
import * as loads from "../src/ui/transport-load-model";
import { transportLoadView } from "../src/ui/space-present";

function fixture() {
  const state=createInitialState(42,4242),home=activePlanet(state);
  home.coordinates={galaxy:1,system:56,position:11};
  home.resources={metal:big(100000),crystal:big(100000),deuterium:big(100000)};
  home.units.small_cargo=2;
  state.research.levels.combustion_drive=2;
  const colony=createPlanet("load-view-colony",{galaxy:1,system:56,position:10});
  state.planets.push(colony);
  const request:FleetRequest={mission:"transport",target:{...colony.coordinates},ships:{small_cargo:2},cargo:emptyCargo(),speedPercent:100};
  return {state,request};
}
afterEach(()=>vi.restoreAllMocks());

describe("ordinary transport load presentation",()=>{
  it("shows exact fuel-reserved cargo numbers without formatting the fleet dashboard",()=>{
    const {state,request}=fixture();
    const details=vi.spyOn(deep,"deepFlightDetails"),charge=vi.spyOn(deep,"chargePreview");
    const before=JSON.stringify({state,request});
    const view=transportLoadView(state,request)!;
    expect(view.summary).toBe("货物占用 0 · 可用货舱 9992 · 往返燃料预留 8 · 总货舱 10000");
    expect(view.reason).toBe("装至上限只改对应资源，派遣需另点按钮。");
    expect(view.maxima.metal.ok).toBe(true);
    expect(view.maxima.metal.amount!.toString()).toBe("9992");
    expect(details).not.toHaveBeenCalled();expect(charge).not.toHaveBeenCalled();
    expect(JSON.stringify({state,request})).toBe(before);
  });

  it("retains the real load, free capacity, fuel and excess on overload",()=>{
    const {state,request}=fixture();request.cargo.metal=big(10000);
    const view=transportLoadView(state,request)!;
    expect(view.summary).toBe("货物占用 10000 · 可用货舱 0 · 往返燃料预留 8 · 总货舱 10000 · 超出 8");
    expect(view.reason).toBe(quoteFlight(state,request).reason);
    expect(view.reason).toContain("货舱不足");
    expect(view.maxima.metal.ok).toBe(true);
    expect(request.cargo.metal.toString()).toBe("10000");
  });

  it("does not make up cargo numbers or hide the quote rejection for invalid cargo",()=>{
    const {state,request}=fixture();request.cargo.metal=big(-1);
    const view=transportLoadView(state,request)!;
    expect(view.summary).toContain("货物占用 —");
    expect(view.summary).toContain("往返燃料预留 8");
    expect(view.reason).toBe(quoteFlight(state,request).reason);
    expect(request.cargo.metal.eq(-1)).toBe(true);
  });

  it.each(["deploy","colonize","scout","charge","recycle"] as const)("leaves %s completely outside the helper",mission=>{
    const {state,request}=fixture();request.mission=mission;
    const preview=vi.spyOn(loads,"transportLoadPreview");
    expect(transportLoadView(state,request)).toBeNull();
    expect(preview).not.toHaveBeenCalled();
  });

  it("changes its projection with the current ships, speed, stock and target without editing the draft",()=>{
    const {state,request}=fixture();
    const initial=transportLoadView(state,request)!;
    request.ships.small_cargo=1;
    expect(transportLoadView(state,request)!.summary).toContain("总货舱 5000");
    request.ships.small_cargo=2;request.speedPercent=10;
    expect(transportLoadView(state,request)!.summary).not.toBe(initial.summary);
    activePlanet(state).resources.crystal=big("554.808618111057");
    expect(transportLoadView(state,request)!.maxima.crystal.amount!.eq(activePlanet(state).resources.crystal)).toBe(true);
    request.target={...activePlanet(state).coordinates};
    const view=transportLoadView(state,request)!;
    expect(view.reason).toContain("当前星球");
    expect(view.maxima.metal.ok).toBe(false);
    expect(request.target).toEqual(activePlanet(state).coordinates);
  });
});
