/**
 * Small deterministic generator (mulberry32) whose whole state is one uint32 kept in the save,
 * so pre-rolled ring machine results cannot be re-rolled by reloading.
 */
export function nextRandom(seed: number): { value: number; seed: number } {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, seed: next };
}

/** Sequential draws from a seed; `seed` holds the state after the last draw. */
export class Rng {
  seed: number;
  constructor(seed: number) {
    this.seed = seed >>> 0;
  }
  next(): number {
    const step = nextRandom(this.seed);
    this.seed = step.seed;
    return step.value;
  }
}

export function freshSeed(): number {
  return (Math.floor(Math.random() * 4294967296) ^ Date.now()) >>> 0;
}
