// Waits, retry counts and portal button words the backend may override through
// the form maps' `tuning` block. Each module registers its own defaults; an
// override only replaces a known key with a value of the same type, so a bad
// map can change a number or a word list but never add behaviour.

type Group = Record<string, unknown>;

const live: Record<string, Group> = {};
let overrides: Record<string, Group> = {};

function sameShape(current: unknown, next: unknown): boolean {
  if (Array.isArray(current)) return Array.isArray(next) && next.every((v) => typeof v === "string");
  return typeof current === typeof next && (typeof next !== "number" || (Number.isFinite(next) && next >= 0));
}

function applyGroup(name: string): void {
  const target = live[name];
  const patch = overrides[name];
  if (!target || !patch) return;
  for (const [key, value] of Object.entries(patch)) {
    if (key in target && sameShape(target[key], value)) target[key] = value;
  }
}

export function tunable<T extends Group>(name: string, defaults: T): T {
  const group = { ...defaults };
  live[name] = group;
  applyGroup(name);
  return group;
}

export function applyTuning(next: unknown): void {
  overrides = next && typeof next === "object" ? (next as Record<string, Group>) : {};
  for (const name of Object.keys(live)) applyGroup(name);
}
