# Diff Seed

Show a structured diff of the cognitive map before and after an update.

## What this does

Snapshots the current `seed.ts`, runs `/update-map`, then compares the result to show exactly what changed: nodes added, removed, renamed, tier changes, and edge modifications.

## Steps

1. **Snapshot the current state**:
   - Read `map-viewer/src/seed.ts` (or `scaffold/src/seed.ts`)
   - Parse the `nodes` and `crossEdges` arrays
   - Store the current node IDs, labels, levels, tiers, and stories in memory

2. **Run the update**:
   - Execute `/update-map` to regenerate the seed
   - OR if the seed was already updated, use `git diff` to see changes:
     ```bash
     git diff map-viewer/src/seed.ts
     ```

3. **Parse the updated state**:
   - Read the new `seed.ts`
   - Parse the updated `nodes` and `crossEdges` arrays

4. **Compare and report**:

   **Nodes Added** (new IDs not in the old set):
   - List each with: ID, label, level, tier, parent
   - Flag if any added node references a non-existent parent

   **Nodes Removed** (old IDs not in the new set):
   - List each with: ID, label, level, tier
   - Check if any cross-edges now have dangling references

   **Nodes Modified** (same ID, different fields):
   - Label changes
   - Tier promotions (st → lt) and demotions (lt → st)
   - Story updates (show diff if significantly different)
   - Level changes (unusual — flag for review)
   - Parent changes (node moved to different hub)

   **Edges Added/Removed/Modified**:
   - New cross-edge connections
   - Removed edges
   - Confidence changes

   **Summary Stats**:
   - Total nodes: before → after
   - Total edges: before → after
   - Tier distribution change
   - Hubs affected

5. **Validate the result**:
   ```bash
   npx tsx scripts/validate-seed.ts
   ```

## When to use

- Immediately after `/update-map` to review what changed
- Before committing seed changes to verify intent
- When investigating unexpected map behavior after an update

## Rules

- Always validate after comparing — the diff alone doesn't catch structural issues
- Highlight tier demotions (lt → st) — these may be unintentional
- Highlight hub removals — these affect the map skeleton
- If no prior state exists in git, just report the current state as "initial map"
