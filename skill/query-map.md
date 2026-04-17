# Query Map

Search and explore the cognitive map using the cogmap query engine.

## What this does

Uses the cogmap MCP tools to answer questions about the project's cognitive map — search for nodes, traverse connections, explore subgraphs, and query knowledge graph facts.

## Steps

1. **Understand the query**: Determine what the user is looking for:
   - A specific concept/component → use `cogmap_search`
   - How things connect → use `cogmap_traverse` or `cogmap_subgraph`
   - What changed → use `cogmap_facts` to check the knowledge graph
   - General overview → use `cogmap_status`

2. **Get map status** (if not recently checked):
   - Call `cogmap_status` to see current hub structure and node counts

3. **Execute the appropriate query**:

   **For searching**: Call `cogmap_search` with the user's query
   - Use `mode: "hybrid"` for best results (combines FTS + semantic)
   - Filter by `level` if looking for hubs vs details
   - Filter by `hub` if the user specified a domain

   **For exploring connections**: Call `cogmap_traverse`
   - Start from a known node ID
   - Use `max_depth: 2` for neighborhood, `3+` for broader exploration
   - Use `direction: "down"` to see what's under something
   - Use `direction: "up"` to see what something belongs to

   **For subgraphs**: Call `cogmap_subgraph`
   - `mode: "hub"` — everything under a hub
   - `mode: "neighborhood"` — nodes near a specific node
   - `mode: "paths"` — how two concepts connect

   **For facts/history**: Call `cogmap_facts`
   - Query temporal facts about any entity
   - Use `as_of` for point-in-time queries

4. **Present findings**: Summarize what you found in a clear format. Include:
   - Node names, levels, and tiers
   - Key connections and edge types
   - Relevant facts or history
   - Suggestions for deeper exploration

## Rules

- Always use the MCP tools — do NOT guess at map contents
- If a search returns no results, try broader terms or semantic mode
- When showing connections, include the edge type (DEPENDS_ON, PRODUCES, etc.)
- Mention draft (st) vs anchored (lt) status when relevant
