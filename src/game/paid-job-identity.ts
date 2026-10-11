import type { DemolitionJob } from "./demolition-state";
import type { OrderKind } from "./order-state";
import type { BuildOrder } from "./planet";
import type { ResearchOrder } from "./research";
import type { ShipyardOrder } from "./shipyard";
import type { GameState } from "./types";

/** Actual work only. Plan receipts and historical transport records are never jobs. */
export type ActualPaidJob =
  | { kind: "building"; planetId: string; job: BuildOrder }
  | { kind: "research"; planetId: string; job: ResearchOrder }
  | { kind: "shipyard"; planetId: string; job: ShipyardOrder }
  | { kind: "demolition"; planetId: string; job: DemolitionJob };
export type PaidJobKind = OrderKind | "demolition";

export function actualPaidJobs(state: GameState): ActualPaidJob[] {
  const jobs: ActualPaidJob[] = state.research.queue.map(job => ({ kind: "research", planetId: job.planetId, job }));
  for (const planet of state.planets) {
    for (const job of planet.buildQueue) jobs.push({ kind: "building", planetId: planet.id, job });
    for (const job of planet.shipyardQueue) jobs.push({ kind: "shipyard", planetId: planet.id, job });
    if (planet.demolition !== null && planet.demolition !== undefined) jobs.push({ kind: "demolition", planetId: planet.id, job: planet.demolition });
  }
  return jobs;
}

/** Global, all-kind identity census; zero-price work owns an ID just like paid work. */
export function paidJobIdentityProblem(state: GameState): string | null {
  const next = state.orders.nextJobId;
  if (!Number.isSafeInteger(next) || next < 1) return "付款 ID 计数器无效";
  const ids = new Set<number>();
  for (const { kind, job } of actualPaidJobs(state)) {
    if (!job || !Number.isSafeInteger(job.jobId) || job.jobId < 1 || job.jobId >= next || ids.has(job.jobId)) return "付款 ID 重复、无效或计数器过期";
    ids.add(job.jobId);
    if (kind === "demolition" && (job.source !== "manual" || job.taskId !== null
      || !Number.isSafeInteger(state.terraformerGrantJobFloor) || state.terraformerGrantJobFloor < 1
      || state.terraformerGrantJobFloor > next || job.jobId < state.terraformerGrantJobFloor)) return "拆除付款身份或发行边界无效";
  }
  return null;
}
