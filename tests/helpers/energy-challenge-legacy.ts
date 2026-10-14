import { expect } from "vitest";

/** Independent r16 migration contract; deliberately not the production factory. */
export function expectedInactiveEnergyChallenge() {
  return { model: "energy-tightening-v1", nextAttemptId: 1, active: null, completion: null } as const;
}

/** Only synthetic current-to-legacy preparation may remove this exact unused state. */
export function stripVerifiedInactiveEnergyChallenge(state: any): void {
  const descriptor = Object.getOwnPropertyDescriptor(state, "energyChallenge");
  expect(descriptor && "value" in descriptor && descriptor.enumerable).toBe(true);
  expect(Object.getPrototypeOf(descriptor!.value)).toBe(Object.prototype);
  expect(Reflect.ownKeys(descriptor!.value)).toHaveLength(4);
  for (const key of ["model", "nextAttemptId", "active", "completion"]) {
    const field = Object.getOwnPropertyDescriptor(descriptor!.value, key);
    expect(field && "value" in field && field.enumerable).toBe(true);
  }
  expect(descriptor!.value).toStrictEqual(expectedInactiveEnergyChallenge());
  delete state.energyChallenge;
}

/** Add the specified default to an old oracle without projecting away current fields. */
export function liftLegacyEnergyChallenge<T extends object>(state: T) {
  expect("energyChallenge" in state).toBe(false);
  return { ...state, energyChallenge: expectedInactiveEnergyChallenge() };
}
