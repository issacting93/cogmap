# Release

Prepare and publish a new cogmap release: validate, bump versions, build, and publish.

## What this does

Runs the full validation suite, bumps the version across all package.json files, builds the viewer, and prepares for npm publish. Ensures everything is consistent before a release goes out.

## Steps

1. **Run full validation suite** (in parallel where possible):
   ```bash
   npx tsx scripts/validate-seed.ts
   npx tsx scripts/graph-integrity.ts
   npx tsx scripts/check-type-sync.ts
   npx tsx scripts/check-tool-parity.ts
   ```
   - All checks must pass before proceeding
   - If any fail, fix the issues first

2. **Run TypeScript compilation checks**:
   ```bash
   cd engine && npx tsc --noEmit && cd ..
   cd scaffold && npx tsc --noEmit && cd ..
   ```

3. **Run MCP smoke test**:
   ```bash
   npx tsx scripts/smoke-test-mcp.ts
   ```

4. **Build the viewer**:
   ```bash
   ./scripts/bundle-check.sh
   ```
   - Verify the bundle is within size budget

5. **Determine version bump**:
   - Ask the user: patch (bug fixes), minor (new features), or major (breaking changes)?
   - Read current version from root `package.json`
   - Calculate new version

6. **Bump versions** across all three package.json files:
   - `package.json` (root — the npm package)
   - `engine/package.json`
   - `scaffold/package.json`
   - Also update the version string in `engine/src/index.ts` (McpServer version)

7. **Update the tool reference docs**:
   ```bash
   npx tsx scripts/generate-tool-docs.ts --output docs/tool-reference.md
   ```

8. **Create release commit**:
   - Stage all changed files
   - Commit with message: `release: vX.Y.Z`
   - Tag: `git tag vX.Y.Z`

9. **Publish** (only if user confirms):
   ```bash
   npm publish
   ```

10. **Report**:
    - New version number
    - What was validated
    - Bundle size
    - Tag name
    - npm publish URL

## Pre-release checklist

Before running this skill, ensure:
- [ ] All intended changes are committed or staged
- [ ] CHANGELOG or README is updated if needed
- [ ] No uncommitted experimental changes in seed.ts

## Rules

- Never skip validation steps — they exist to catch regressions
- Never bump a major version without explicit user confirmation
- Always create a git tag matching the npm version
- Don't publish if any validation step failed
- If the user says "dry run", do everything except the actual `npm publish`
