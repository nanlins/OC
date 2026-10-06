# Memory Doctrine

How your memory system works — read this once, then maintain it as designed.

## Files

- `memory/index.md` — the **index**: the single source that maps every concept file.
  It is core data; keep it accurate before anything else.
- `memory/system/definition.md` — this doctrine file.
- Concept files live anywhere under `memory/` and are listed in the index.

## Principles

1. **Entity-centric**: one file per entity (project, person, preference cluster).
2. **Patterns over instances**: store what repeats, not one-off events.
3. **In-place correction**: a changed fact is edited where it lives; stale lines are
   deleted, not kept as history.
4. **Index is truth**: if the index does not list a file, treat that file as dormant.

## When to update

- After the user states a preference, constraint, or durable fact about themselves.
- After you finish meaningful work on a project (update its concept file).
- When you create, rename, or delete a concept file (update the index).

## Budget

Memory is loaded into every session prompt. Keep files lean; prefer short bullet
facts over prose. If a file grows beyond the budget it will be truncated on load —
that is a signal to slim it down, not to move facts elsewhere silently.
