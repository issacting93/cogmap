# cogmap

**An interactive cognitive map for your project — visualised as a metro map, kept in sync by Claude Code.**

Over the last two semesters I've been part of a research lab at NYU Tandon, working with Professor Vedant at the intersection of work, Human-AI interaction, and wellness. Cogmap is one of the things that came out of it.

The idea: what if you could see your entire project — every idea, file, concept, and connection — laid out like a transit map? And what if it stayed current automatically, without you having to do anything?

That's cogmap. An npm package that scaffolds a metro-style map viewer and wires it to Claude Code, so your project always has a live visual you can actually navigate.

> *Written mostly on the NYC subway with barely any signal. The MTA map was absolutely not an influence. Definitely not a cliché designer move.*

---

## Quick Start

```bash
npx cogmap init --name "My Project"
cd map-viewer && npm run dev
```

Then inside Claude Code:

```
/update-map
```

Claude reads your project — README, directory structure, git history — and populates the map with nodes and connections. Vite hot-reloads, your browser updates live.

---

## What Gets Created

```
your-project/
├── map-viewer/           # Standalone Vite + React app
│   └── src/
│       ├── seed.ts       # Your project's nodes & edges (Claude generates this)
│       ├── store.ts      # Zustand state management
│       ├── constants.ts  # Shared theme (colors, fonts, IDs)
│       ├── components/   # Search, filters, pathfinding UI
│       └── map/          # Metro map renderer (SVG + optional Three.js terrain)
├── map-engine/           # MCP server (SQLite, FTS5 search, graph traversal)
└── .claude/
    └── commands/
        ├── update-map.md   # /update-map — regenerate map from project state
        ├── query-map.md    # /query-map — search and traverse the map
        └── map-context.md  # /map-context — assemble context layers for Claude
```

---

## How the Map Works

The map uses a transit metaphor to organize information by scale:

| Level | Visual | For |
|-------|--------|-----|
| **Hub** | Large filled circle | Top-level pillars (4–7 per project) |
| **Junction** | Medium outlined circle | Major sub-components |
| **Stop** | Small circle | Specific concepts, files, features |
| **Marker** | Tiny dot | Leaf-level detail (use sparingly) |

Nodes also have a **tier** that reflects maturity:
- `lt` (anchored) — solid circle — stable, validated, complete
- `st` (draft) — dashed circle — in progress, uncertain, or blocked

**Cross-edges** are dashed transfer lines connecting concepts across hubs: shared dependencies, data flows, causal chains — anything that doesn't fit neatly on one line.

---

## Features

### Search

Press `/` anywhere on the map to open search. Type-ahead matches against node labels and descriptions, ranked by relevance. Select a result and the map pans and zooms to it automatically.

### Filters

Toggle visibility by level (Hub, Junction, Stop, Marker), status (Anchored, Draft), or individual lines. A live count shows how many nodes are visible. Collapse the panel when you don't need it.

### Pathfinding

Click the **Route** button in the search bar to enter path mode. Pick a start and end node, hit **Find Path**, and the shortest route is highlighted on the map — a thick animated blue line with a step-by-step panel showing each hop and whether it follows the hierarchy or a cross-edge.

Useful for understanding how concepts connect across different parts of your project, and for defining intentional context windows for a model.

### Direct Manipulation

- **Click** a station to inspect its label, notes, and line
- **Click a transfer line** to select it — change its relationship type or delete it
- **Drag** the background to pan around the map
- **Scroll wheel** to zoom in and out
- **Double-click** empty space to drop a new node
- **Sparkle button** to suggest connections based on text similarity
- **Connect mode** to draw your own cross-edges between any two nodes
- **Anchor / Draft** to toggle a node's maturity state in either direction

---

## MCP Engine

The map-engine provides 8 MCP tools that Claude Code can call directly:

| Tool | What it does |
|------|-------------|
| `cogmap_status` | Node/edge/fact counts, hub overview |
| `cogmap_search` | Hybrid search (FTS5 + TF-IDF semantic) with level/tier/hub filters |
| `cogmap_traverse` | BFS/DFS graph walk from any node |
| `cogmap_subgraph` | Extract hub subgraphs, neighborhoods, or paths between nodes |
| `cogmap_context` | 4-layer context assembly (identity, hub summary, subgraph, deep search) |
| `cogmap_facts` | Query the knowledge graph (subject/predicate/object with temporal validity) |
| `cogmap_add_fact` | Add a temporal fact |
| `cogmap_invalidate_fact` | Mark a fact as expired |

The engine watches `seed.ts` for changes and reloads automatically — no restart needed.

---

## How `/update-map` Works

The intelligence lives in the Claude Code skill, not the renderer. When you run `/update-map`, Claude:

1. Reads your project state (docs, directory tree, git log, MEMORY.md)
2. Infers or updates the hub structure
3. Regenerates `map-viewer/src/seed.ts`
4. Vite hot-reloads — the map updates in your browser instantly

The renderer is intentionally generic. Claude provides the project-specific content.

---

## This Isn't Just for Developers

You can use cogmap to visualise any kind of text-based work — research notes, writing projects, documentation, worldbuilding, fanfic, whatever makes sense to you. If it has structure, it can have a map.

The project runs entirely locally. No data leaves your machine.

---

## Architecture

The codebase is split into three layers:

- **scaffold/** — Vite + React viewer. Pure SVG rendering, force-directed layout, Zustand state. No external graph library. DM Mono typeface, Material Symbols icons.
- **engine/** — Node.js MCP server backed by SQLite (WAL mode). FTS5 full-text search, TF-IDF semantic similarity, BFS/DFS traversal, knowledge graph with temporal facts, and a 4-layer context assembly system with token budgeting.
- **skill/** — Claude Code slash commands that bridge the two. `/update-map` reads your project and writes seed data. `/query-map` and `/map-context` let Claude navigate the map programmatically.

All shared constants (colors, fonts, IDs) live in a single `constants.ts` module.

---

## Inspiration

Cogmap wouldn't exist without [memPalace](https://github.com/MemPalace/mempalace).

memPalace is a local-first AI memory system built around a spatial metaphor: your conversation history is structured like a physical building, where people and projects become wings, topics become rooms, and the actual content lives in drawers. It retrieves memories through semantic search scoped to that structure — no summarisation, no paraphrasing, verbatim storage.

What struck me about it was the underlying idea: that the way you *organise* information spatially changes how you *navigate* it. memPalace applied that to memory and retrieval. I wanted to apply something similar to active project work — not "where did I put that note" but "how does this whole thing connect". The metro map metaphor felt right because transit maps are designed to make complex networks legible at a glance. You don't need to know every detail of the system; you just need to see the lines, the stops, and how to get from A to B.

That's what cogmap tries to be: a legibility layer for whatever you're building or thinking through.

This connects to the broader research question I'm exploring: how do we improve the way we work *with* these models while avoiding AI codependency? Cogmap is one attempt at an answer — giving you a spatial, navigable view of your own thinking so you stay in control of the context.

---

## Feedback

If this sounds interesting, please try it. I'd genuinely appreciate any feedback, bug reports, or ideas — this is early and I'm actively improving it. Sorry in advance for any rough edges.

---

## License

MIT
