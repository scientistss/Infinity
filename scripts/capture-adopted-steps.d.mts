export function captureAdoptedSteps<S, R extends { state: S }>(state: S, advance: (state: S) => R, serialize: (state: S) => unknown): {
  result: R; adoptedSegmentsSeconds: number[]; npcElapsedSeconds: number; observation: string;
};
