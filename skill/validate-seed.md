# Validate Seed

Run structural and referential integrity checks on the cognitive map seed file.

## What this does

Validates `map-viewer/src/seed.ts` (or `scaffold/src/seed.ts`) against the cogmap schema rules:
- Required fields and correct types on every node
- ID uniqueness across all nodes and edges
- Parent references resolve to existing nodes
- Exactly one world-level root node
- Every hub has children
- Story fields are populated
- Cross-edge source/target nodes exist
- Edge confidence values are in range
- No self-loops or duplicate edges
- Level hierarchy is respected (no skipping levels)

## Steps

1. **Run the validation script**:
   ```bash
   npx tsx scripts/validate-seed.ts
   ```

2. **Review the output**:
   - **Stats** section shows node/edge counts, hub count, level and tier distribution
   - **Warnings** are non-blocking quality issues (missing stories, sparse hubs, etc.)
   - **Errors** are structural problems that will cause viewer or engine failures

3. **Fix any errors**:
   - For missing parent references: check if the parent node was renamed or removed
   - For duplicate IDs: rename one of the duplicates
   - For dangling edges: update or remove the cross-edge
   - For invalid levels/tiers: correct to valid enum values

4. **Address warnings** (optional but recommended):
   - Add `story` fields to nodes that lack them
   - Expand hubs with only 1 child
   - Promote stable nodes from `st` to `lt`

## When to use

- Before committing changes to `seed.ts`
- After running `/update-map` to verify generated output
- As a sanity check when the viewer shows unexpected behavior
- In CI to gate merges

## Rules

- Do NOT modify `validate-seed.ts` — it's a shared validation script
- If a check seems wrong, investigate the seed file first
- Warnings are informational — they don't block CI but should be addressed over time
