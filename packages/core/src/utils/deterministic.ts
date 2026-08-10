/** Small deterministic selectors shared by planning and rendering. */
export function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function stableUnitInterval(value: string): number {
  return Math.min(hashString(value), 0x7fffffff) / 0x80000000;
}
