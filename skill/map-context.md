# Map Context

Assemble context-engineered cognitive map data for the current task.

## What this does

Uses the cogmap query engine's 4-layer context stack to load exactly the right amount of project knowledge into the conversation. Minimizes token usage while maximizing relevance.

## Context layers

| Layer | Name | Tokens | Content |
|-------|------|--------|---------|
| 0 | Identity | ~100 | Project name, hub list, node/edge counts, tier distribution |
| 1 | Hub Summary | ~500-800 | All hubs with child counts, aspects, and key cross-edges |
| 2 | Subgraph | ~200-500 | Nodes and edges relevant to a specific topic |
| 3 | Deep Search | unlimited | Full search results with stories, context, and KG facts |

## Steps

1. **Determine the topic**: 
   - If the user specified a topic, use that
   - If working on a task, infer the topic from the task description
   - If unclear, ask the user

2. **Choose the right layers**:
   - Quick orientation → layers [0, 1]
   - Working on a specific area → layers [0, 1, 2]
   - Deep investigation → layers [0, 1, 2, 3]

3. **Call `cogmap_context`**:
   - Set `query` to the topic
   - Set `layers` based on the depth needed
   - Set `hub_focus` if the user is working within a specific hub
   - Set `max_tokens` based on how much context is needed (default 2000)

4. **Use the context**: The assembled context is now available for the conversation. Reference specific nodes and connections when making suggestions or answering questions.

## When to use this

- **Before starting work** on a module/feature — load L0+L1 for orientation
- **When exploring** a specific area — load L2 with the topic
- **When investigating** a bug or design question — load L3 for full depth
- **When the user asks** "what do you know about X" — load L2+L3

## Rules

- Start with fewer layers and add more only if needed
- Layer 0+1 costs ~900 tokens — cheap to always include
- Layer 3 can be large — only use when depth is needed
- Mention which layers you loaded so the user understands the context depth
