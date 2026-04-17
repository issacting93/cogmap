# cogmap

Interactive cognitive map for any project. Scaffolds a metro-style map viewer that [Claude Code](https://claude.ai/code) keeps in sync with your project state.

## Quick start

```bash
npx cogmap init --name "My Project"
cd map-viewer && npm run dev
```

Then in Claude Code:

```
/update-map
```

Claude reads your project (README, directory structure, git history) and populates the map with nodes and connections.

## What it creates

```
your-project/
├── map-viewer/           # Standalone Vite+React app
│   └── src/
│       ├── seed.ts       # Project-specific nodes & edges (Claude generates this)
│       ├── store.ts      # Zustand state management
│       └── map/          # Metro map renderer (SVG + Three.js terrain)
└── .claude/
    └── commands/
        └── update-map.md # /update-map skill for Claude Code
```

## How it works

The map uses a metro/transit metaphor:

| Level | Visual | Use for |
|-------|--------|---------|
| **Hub** (parts) | Large target circle | Top-level pillars (4-7 per project) |
| **Junction** (aspects) | Medium outlined circle | Major sub-components |
| **Stop** (points) | Small circle | Specific concepts, files, features |
| **Marker** (stories) | Tiny dot | Leaf data (use sparingly) |

Nodes have a **tier** that signals maturity:
- `lt` (anchored) = solid circle = validated, complete, stable
- `st` (draft) = dashed circle = in-progress, uncertain, blocked

**Cross-edges** (dashed transfer lines) connect concepts across hubs — shared dependencies, data flows, causal chains.

## Interaction

- **Click** a station to inspect (label, notes, line)
- **Pan** by dragging the background
- **Zoom** with scroll wheel
- **Double-click** empty space to add a node
- **Sparkle button** suggests connections from text similarity

## The `/update-map` skill

The intelligence is in the Claude Code skill, not the renderer. When you run `/update-map`, Claude:

1. Reads your project state (docs, directory structure, git log, MEMORY.md)
2. Infers or updates the hub structure
3. Regenerates `map-viewer/src/seed.ts`
4. Vite hot-reloads — the browser updates live

The renderer is generic. Claude generates project-specific content.

## License

MIT
