# Audit Map

Run a comprehensive quality audit on the cognitive map: graph integrity, content coverage, and structural health.

## What this does

Combines graph integrity checks with content quality analysis to give a full picture of the map's health. Goes beyond `/validate-seed` to check connectivity, balance, orphans, and tier distribution.

## Steps

1. **Run graph integrity check**:
   ```bash
   npx tsx scripts/graph-integrity.ts
   ```

2. **Run seed validation**:
   ```bash
   npx tsx scripts/validate-seed.ts
   ```

3. **Run type sync check**:
   ```bash
   npx tsx scripts/check-type-sync.ts
   ```

4. **Check tool-skill parity** (if engine changes were made):
   ```bash
   npx tsx scripts/check-tool-parity.ts
   ```

5. **Compile audit summary**: Based on the script outputs, create a report covering:

   **Graph Health:**
   - Is the graph fully connected? (should be 1 component)
   - Are there hierarchy cycles?
   - Any orphan nodes?
   - Hub balance (are some hubs much larger than others?)

   **Content Quality:**
   - What percentage of nodes have stories?
   - Are any hubs empty or have only 1 child?
   - What's the draft (st) vs anchored (lt) ratio?
   - Are edge confidence values reasonable?

   **Structural Alignment:**
   - Do engine and scaffold types match?
   - Do all skills reference valid MCP tools?

6. **Recommend actions**: Based on findings, suggest specific improvements:
   - Nodes that should be promoted st → lt
   - Hubs that should be split or merged
   - Missing cross-edges between related concepts
   - Stories that need writing

## When to use

- Periodic health check (weekly or before releases)
- After large map updates
- When onboarding a new contributor who needs to understand map quality
- Before presenting the map to stakeholders

## Rules

- Run all scripts before compiling the summary — don't skip any
- Prioritize errors over warnings in recommendations
- Be specific in recommendations: name the nodes, not just the issue
