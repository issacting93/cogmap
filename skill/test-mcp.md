# Test MCP

Smoke-test the cogmap MCP server: boot it, call each tool, and verify responses.

## What this does

Spawns the MCP engine as a child process, sends test requests to each registered tool, and verifies the server boots cleanly and responds with valid data. Catches regressions in the MCP server, database initialization, seed loading, and tool handlers.

## Steps

1. **Run the smoke test**:
   ```bash
   npx tsx scripts/smoke-test-mcp.ts
   ```

2. **Review the output**:
   - Server startup: confirms the engine boots and loads the seed
   - Tool list: shows all registered MCP tools
   - Per-tool results: PASS/FAIL for each tested tool
   - Summary: total pass/fail count

3. **If tests fail**:

   **Server won't start:**
   - Check that `engine/src/index.ts` exists and compiles
   - Verify dependencies: `cd engine && npm install`
   - Check seed file exists: `ls map-viewer/src/seed.ts`
   - Check for TypeScript errors: `cd engine && npx tsc --noEmit`

   **Tool returns error:**
   - Read the error message — it usually points to the failing module
   - Common issues:
     - Database schema mismatch → delete `map-engine/data/cogmap.db` and retry
     - Seed parse failure → run `/validate-seed` first
     - Missing function export → check the import in `index.ts`

   **Timeout:**
   - The server has 15 seconds to start and 10 seconds per tool call
   - If timing out, check for infinite loops or blocking I/O in the handler

4. **Verify tool-skill parity** (optional):
   ```bash
   npx tsx scripts/check-tool-parity.ts
   ```

## When to use

- After modifying any engine source code
- After adding or changing MCP tool definitions
- After upgrading dependencies (especially better-sqlite3 or @modelcontextprotocol/sdk)
- Before releasing a new version
- In CI to catch regressions

## Rules

- The smoke test uses a temporary database — it won't affect your real data
- If the test passes but tools behave differently in Claude Code, check the MCP config in `.claude/settings.local.json`
- Don't modify the smoke test to skip failing tools — fix the tools instead
