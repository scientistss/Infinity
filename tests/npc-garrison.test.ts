import { describe, expect, it, vi } from "vitest";
import { fightEncounter } from "../src/game/encounter-combat";
import { coordinateRandom, type Coordinates } from "../src/game/galaxy";
import { initialNpcGarrison, isNpcCoordinates, isNpcGarrison, isNpcUniverseSeed, NPC_COMBAT_TECH, NPC_GARRISON_SALT, survivingNpcGarrison, type NpcGarrison } from "../src/game/npc-garrison";

const small = { galaxy: 1, system: 1, position: 6 };
const large = { galaxy: 1, system: 2, position: 3 };

describe("standalone NPC permanent orbital garrison", () => {
  it("uses fixed salt 101 and zero combat technology", () => {
    expect(NPC_GARRISON_SALT).toBe(101);
    expect(NPC_COMBAT_TECH).toEqual({ weapons: 0, shields: 0, armour: 0 });
    expect(Object.isFrozen(NPC_COMBAT_TECH)).toBe(true);
  });

  // Hand-calculated unsigned coordinate-hash goldens, independent of this module.
  it.each([
    [0, { galaxy: 1, system: 1, position: 3 }, { light_fighter: 4, heavy_fighter: 0 }],
    [0, { galaxy: 1, system: 1, position: 13 }, { light_fighter: 8, heavy_fighter: 1 }],
    [1, small, { light_fighter: 4, heavy_fighter: 0 }],
    [1, large, { light_fighter: 8, heavy_fighter: 1 }],
    [123456, { galaxy: 1, system: 1, position: 1 }, { light_fighter: 8, heavy_fighter: 1 }],
    [0xffffffff, { galaxy: 1, system: 1, position: 1 }, { light_fighter: 4, heavy_fighter: 0 }],
  ] as const)("matches fixed coordinate golden seed %s at %j", (seed, coordinate, expected) => {
    expect(initialNpcGarrison(seed, coordinate)).toEqual(expected);
    expect(Object.isFrozen(initialNpcGarrison(seed, coordinate))).toBe(true);
  });

  it("uses the 75-percent threshold without consuming unrelated randomness or time", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw Error("random"); });
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw Error("time"); });
    try {
      for (let position = 1; position <= 15; position += 1) {
        const coordinate = { galaxy: 2, system: 13, position };
        expect(initialNpcGarrison(72, coordinate)).toEqual(coordinateRandom(72, coordinate, 101) < 0.75
          ? { light_fighter: 4, heavy_fighter: 0 } : { light_fighter: 8, heavy_fighter: 1 });
      }
      expect(random).not.toHaveBeenCalled(); expect(clock).not.toHaveBeenCalled();
    } finally { random.mockRestore(); clock.mockRestore(); }
  });

  it("allows only monotone integer losses and retains explicit zero counts", () => {
    const first = initialNpcGarrison(1, large);
    const next = survivingNpcGarrison(first, { light_fighter: 3, heavy_fighter: 0 }, 1, large);
    const dead = survivingNpcGarrison(next, { light_fighter: 0, heavy_fighter: 0 }, 1, large);
    expect(next).toEqual({ light_fighter: 3, heavy_fighter: 0 });
    expect(dead).toEqual({ light_fighter: 0, heavy_fighter: 0 });
    expect(first).toEqual({ light_fighter: 8, heavy_fighter: 1 });
    expect(() => survivingNpcGarrison(dead, next, 1, large)).toThrow(TypeError);
    expect(() => survivingNpcGarrison(next, first, 1, large)).toThrow(TypeError);
  });

  it("stores counts alone; a fresh kernel call reconstructs full hull and shields", () => {
    const counts = survivingNpcGarrison(initialNpcGarrison(1, large), { light_fighter: 3, heavy_fighter: 1 }, 1, large);
    const battle = () => fightEncounter({ light_fighter: 3 }, { ...counts }, NPC_COMBAT_TECH, NPC_COMBAT_TECH, 82);
    const first = battle();
    expect(first.rounds.length).toBeGreaterThan(0);
    expect(battle()).toEqual(first);
    expect(Reflect.ownKeys(counts)).toEqual(["light_fighter", "heavy_fighter"]);
  });

  it.each([undefined, null, [], {}, { light_fighter: 4 }, { light_fighter: 4, heavy_fighter: 1 },
    { light_fighter: 5, heavy_fighter: 0 }, { light_fighter: -1, heavy_fighter: 0 },
    { light_fighter: 0.1, heavy_fighter: 0 }, { light_fighter: NaN, heavy_fighter: 0 },
    { light_fighter: Infinity, heavy_fighter: 0 }, { light_fighter: "4", heavy_fighter: 0 },
    { light_fighter: 4, heavy_fighter: 0, hull: 400 },
    { light_fighter: 4, heavy_fighter: 0, [Symbol("extra")]: 0 },
    Object.create({ light_fighter: 4, heavy_fighter: 0 }),
  ].map(value => [value] as const))("rejects malformed or over-initial small garrison %j", value => {
    expect(isNpcGarrison(value, 1, small)).toBe(false);
    expect(() => survivingNpcGarrison(initialNpcGarrison(1, small), value as NpcGarrison, 1, small)).toThrow(TypeError);
  });

  it("checks own data fields without evaluating getters", () => {
    let reads = 0;
    const bad = Object.defineProperty({ light_fighter: 4 }, "heavy_fighter", { enumerable: true, get() { reads += 1; return 0; } });
    expect(isNpcGarrison(bad, 1, small)).toBe(false); expect(reads).toBe(0);
    const hidden = Object.defineProperty({ light_fighter: 4 }, "heavy_fighter", { value: 0 });
    expect(isNpcGarrison(hidden, 1, small)).toBe(false);
    expect(isNpcGarrison(Object.assign(Object.create(null), { light_fighter: 4, heavy_fighter: 0 }), 1, small)).toBe(true);
  });

  it.each([-1, 0.1, NaN, Infinity, 0x100000000, "1", undefined])("rejects invalid seed %s", seed => {
    expect(isNpcUniverseSeed(seed)).toBe(false);
    expect(() => initialNpcGarrison(seed as number, small)).toThrow(TypeError);
  });

  it.each([null, [], { ...small, galaxy: 0 }, { ...small, galaxy: 6 }, { ...small, system: 101 },
    { ...small, position: 16 }, { ...small, position: 0 }, { ...small, position: 1.5 },
    { ...small, position: "6" }, { ...small, extra: 0 }, Object.create(small),
  ].map(value => [value] as const))("rejects invalid coordinate %j", coordinate => {
    expect(isNpcCoordinates(coordinate)).toBe(false);
    expect(() => initialNpcGarrison(1, coordinate as Coordinates)).toThrow(TypeError);
  });
});
