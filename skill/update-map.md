# Update Map

Regenerate the cognitive map seed data from current project state, then ensure the viewer is running.

## What this does

Reads the current project state — directory structure, documentation, git history, and Claude's auto-memory — and regenerates `map-viewer/src/seed.ts` with updated nodes, tiers, and cross-edges. The running Vite dev server hot-reloads automatically.

## Steps

1. **Read current project state** (in parallel):
   - Read Claude's auto-memory (MEMORY.md in the project's `.claude/` memory directory) if it exists
   - Read any CLAUDE.md, README.md, or top-level documentation
   - Run `ls` on the project root to understand directory structure
   - Run `git log --oneline -15` to see recent activity
   - Read existing `map-viewer/src/seed.ts` to understand current map state

2. **Determine the hub structure**:
   - If seed.ts already has hubs, preserve them — only add/remove/update nodes within them
   - If seed.ts is empty (first run), infer 4-7 hubs from the project's natural divisions:
     - Major directories or modules often map to hubs
     - Cross-cutting concerns (testing, deployment, security) can be their own hubs
     - Research projects: organize by conceptual pillars, not temporal phases
     - Software projects: organize by system boundaries (API, data, UI, infra)
   - Each hub needs a short `story` explaining what it represents

3. **Populate nodes**:
   - For each hub, identify the key concepts/components/modules as `aspects` (junctions)
   - Under each aspect, add specific items as `points` (stops)
   - Use `stories` (markers) sparingly — only for leaf-level data points worth tracking
   - Set tier based on status:
     - `lt` (anchored) = implemented, tested, validated, documented, stable
     - `st` (draft) = planned, in-progress, blocked, uncertain, incomplete
   - Every node MUST have a `story` field — this is the tooltip content when clicked. Make it informative, not just a label repeat.

4. **Add cross-edges**:
   - Identify concepts that bridge across hubs (shared dependencies, data flows, causal chains)
   - Use semantic edge types: `DEPENDS_ON`, `PRODUCES`, `VALIDATES`, `BLOCKS`, `IMPLEMENTS`, `DOCUMENTS`, `RELATED_TO`, `MAPS_TO`, `OPERATIONALIZES`
   - Set confidence: 0.95 = definitional, 0.90 = strong, 0.85 = clear indirect, 0.80 = conceptual

5. **Write the seed file**:
   - Update `map-viewer/src/seed.ts`
   - Preserve the file structure: types import, helpers, hub sections, cross-edges, summary comment
   - Maintain stable node IDs — do NOT rename existing nodes
   - Update the summary comment at the bottom with accurate counts
   - The file must be valid TypeScript that type-checks cleanly

6. **Verify the viewer**:
   - Check if Vite dev server is running: `curl -s http://localhost:5173/ | head -5`
   - If not running: `cd map-viewer && npx vite --host &`
   - Report the URL to the user

## Seed file format

```typescript
import type { MemoryNode, CrossEdge } from './types';

let _id = 0;
const edgeId = () => `xe_${++_id}`;

const WORLD: MemoryNode = {
  id: '__overview_world__', label: 'Project', level: 'world', tier: 'lt',
  parentId: null, x: 600, y: 450,
};

// Hub (parts) — large circle, gets its own color-coded metro line
const my_hub: MemoryNode = {
  id: 'my_hub', label: 'Hub Name', level: 'parts', tier: 'lt',
  parentId: '__overview_world__',
  story: 'What this hub represents.',
  x: 400, y: 300,
};

// Junction (aspects) — medium circle, groups stops under a hub
const my_junction: MemoryNode = {
  id: 'my_junction', label: 'Junction', level: 'aspects', tier: 'lt',
  parentId: 'my_hub',
  story: 'What this junction groups.',
  x: 380, y: 250,
};

// Stop (points) — small circle, a specific concept/component
const my_stop: MemoryNode = {
  id: 'my_stop', label: 'Stop', level: 'points', tier: 'st',
  parentId: 'my_junction',
  story: 'Details about this item.',
  x: 360, y: 220,
};

export const nodes: MemoryNode[] = [WORLD, my_hub, my_junction, my_stop];

export const crossEdges: CrossEdge[] = [
  { id: edgeId(), sourceAnchorId: 'a', targetAnchorId: 'b', edgeType: 'DEPENDS_ON', confidence: 0.90 },
];
```

## Visual reference

| Level | Metro role | Circle style | Use for |
|-------|-----------|-------------|---------|
| `parts` | Hub | Large target (color ring + white + dot) | Top-level pillars (4-7 total) |
| `aspects` | Junction | Medium outlined circle | Major sub-components |
| `points` | Stop | Small filled/outlined circle | Specific concepts, files, features |
| `stories` | Marker | Tiny dot | Leaf data points (use sparingly) |

| Tier | Rendering | Meaning |
|------|-----------|---------|
| `lt` | Solid | Validated, complete, stable |
| `st` | Dashed | In-progress, uncertain, blocked |

## Rules

- Keep total node count between 40-80 (too few = useless, too many = visual noise)
- Do NOT add nodes for trivial details — each node should be worth navigating to
- Do NOT remove or rename existing hub IDs — the hub structure is the map's skeleton
- DO promote nodes from st → lt when evidence of completion exists
- DO update `story` fields with current findings/numbers/status
- DO add cross-edges when you discover conceptual bridges
- x/y coordinates are used by the 3D terrain view; the 2D metro map computes its own layout via force simulation. Spread hubs across a ~1200x900 grid.

## What NOT to do
- Do not modify any map component files (MapTerrainView, MapTerrainCanvas, mapForceLayout)
- Do not modify store.ts, App.tsx, or types.ts
- Only modify seed.ts
