import { CURRENT_PHASE, buildingById } from "../src/data/buildings";
import { describe, expect, it } from "vitest";
import { present, summarizeBuilds } from "../src/ui/present";
import { enqueue } from "../src/game/queue";
import { stateWith } from "./helpers";

describe("view model", () => {
  it("groups offline builds per building", () => {
    expect(
      summarizeBuilds([
        { building: "metal_mine", level: 10 },
        { building: "solar_plant", level: 7 },
        { building: "metal_mine", level: 11 },
        { building: "metal_mine", level: 12 },
      ]),
    ).toEqual(["金属矿 等级 10 → 12（3 次）", "太阳能电站 → 等级 7"]);
  });

  it("shows storage fill, queue and upgrade labels", () => {
    let state = stateWith({ metal_mine: 3, solar_plant: 3 }, { metal: 9500, crystal: 2000 });
    state = enqueue(state, "metal_mine", "manual").state;
    const model = present(state, { status: "", banner: null, notice: null, catchup: null });
    const metal = model.resources.find((r) => r.id === "metal");
    expect(metal?.fill).toBe("warn");
    expect(metal?.cap).toBe("/ 1.00e4");
    expect(model.queue.items).toHaveLength(1);
    expect(model.queue.items[0]?.label).toBe("金属矿 → 等级 4");
    const mine = model.buildings.find((b) => b.id === "metal_mine");
    expect(mine?.button).toBe("升级到 等级 5");
    expect(mine?.level).toBe("3（队列中 +1）");
    expect(CURRENT_PHASE).toBe(3);
    expect(model.buildings.filter(building => buildingById(building.id).phase > 3).map(building => building.id)).toEqual(["terraformer"]);
    const terraformer = model.buildings.find(building => building.id === "terraformer");
    expect(terraformer).toMatchObject({ level: "0", button: "升级到 等级 1", canEnqueue: false });
    expect(terraformer!.requires).toContain("纳米机器人工厂");
    expect(terraformer!.requires).toContain("能源技术");
    expect(terraformer!.reason).not.toContain("阶段");
    for (const id of ["space_dock", "lunar_base", "sensor_phalanx", "jump_gate", "alliance_depot"]) {
      expect(model.buildings.some(building => building.id === id), `${id} must remain hidden`).toBe(false);
    }
  });
});
