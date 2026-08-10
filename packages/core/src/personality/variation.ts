/**
 * Deterministic phrase variation.
 *
 * A persona shouldn't sound robotic (always the exact same sentence for the
 * same kind of moment), but unit tests must stay reproducible — so instead of
 * `Math.random()`, we pick a variant deterministically from a seed string
 * (e.g. the query's subject+relation). The SAME input always renders the
 * SAME way (testable, explainable), while DIFFERENT inputs get variety.
 */
import { hashString, stableUnitInterval } from "@/utils/deterministic";

export { hashString, stableUnitInterval };

export function assistantOpeningKey(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  const [opening = normalized] = normalized.split(/[，。！？!?：:\n]/u, 1);
  return `opening-${hashString(opening.slice(0, 16)).toString(36)}`;
}

export function pickNonRepeatingText(
  items: readonly string[],
  seed: string,
  recentOpeningKeys: readonly string[],
): string {
  if (items.length === 0) {
    throw new Error("pickNonRepeatingText: `items` must not be empty");
  }
  const start = hashString(seed) % items.length;
  for (let offset = 0; offset < items.length; offset += 1) {
    const candidate = items[(start + offset) % items.length]!;
    if (!recentOpeningKeys.includes(assistantOpeningKey(candidate))) {
      return candidate;
    }
  }
  return items[start]!;
}

/** Deterministically pick one item from `items`, keyed by `seed`. */
export function pickBySeed<T>(items: readonly T[], seed: string): T {
  if (items.length === 0) {
    throw new Error("pickBySeed: `items` must not be empty");
  }
  const index = hashString(seed) % items.length;
  // Non-null: index is in [0, items.length) and items.length > 0 was checked above.
  return items[index]!;
}
