/**
 * Re-export only. The implementation lives in `knowledge/entityLookup.ts`
 * because `rules/` (the is-a traversal) needs it and `reasoners/` already
 * depends on `rules/`, so the shared helper has to sit below both.
 */
export { matchByEntity } from "@/knowledge/entityLookup";
