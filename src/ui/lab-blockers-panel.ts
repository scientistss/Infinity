import type { LabBlockersModel } from "./lab-blockers-model";

export function labBlockersHtml(): string {
  return `<details class="research-lab-blockers" data-bind="research-lab-blockers" hidden>
    <summary data-bind="research-lab-blockers-summary"><span data-bind="research-lab-blockers-headline"></span><span data-bind="research-lab-blockers-protection" hidden></span></summary>
    <p data-bind="research-lab-blockers-note"></p>
    <ul data-bind="research-lab-blockers-list"></ul>
  </details>`;
}

/** Native details owns its open state; reading/toggling grants no game action. */
export function updateLabBlockers(root: HTMLElement, model: LabBlockersModel | null): void {
  const details = root.querySelector<HTMLDetailsElement>('[data-bind="research-lab-blockers"]')!;
  const summary = root.querySelector<HTMLElement>('[data-bind="research-lab-blockers-headline"]')!;
  const note = root.querySelector<HTMLElement>('[data-bind="research-lab-blockers-note"]')!;
  const list = root.querySelector<HTMLElement>('[data-bind="research-lab-blockers-list"]')!;
  const items = model?.items ?? [];
  const hidden = items.length === 0;
  if (details.hidden !== hidden) details.hidden = hidden;
  if (hidden && details.open) details.open = false;
  if (summary.textContent !== (model?.summary ?? "")) summary.textContent = model?.summary ?? "";
  if (note.textContent !== (model?.note ?? "")) note.textContent = model?.note ?? "";
  // Include all displayed facts so renames, imports and queue moves refresh even
  // when paid IDs happen to match. Never retain the source state or job objects.
  const key = JSON.stringify(items);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.replaceChildren(...items.map(item => {
    const row = document.createElement("li");
    row.dataset.planetId = item.planetId;
    row.dataset.jobId = String(item.jobId);
    row.dataset.kind = item.kind;
    row.dataset.queuePosition = item.queuePosition === null ? "" : String(item.queuePosition);
    row.textContent = item.text;
    return row;
  }));
}

/** Called by the existing presentation guard, even before a skipped paint. */
export function updateLabBlockersProtection(root: HTMLElement, writable: boolean, reason: string): void {
  const note = root.querySelector<HTMLElement>('[data-bind="research-lab-blockers-protection"]')!;
  if (note.hidden !== writable) note.hidden = writable;
  const text = writable ? "" : " · 保护中：显示冻结进度";
  if (note.textContent !== text) note.textContent = text;
  const title = writable ? "" : reason;
  if (note.title !== title) note.title = title;
}
