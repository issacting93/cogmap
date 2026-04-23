# Related Research

## 1. Context Rot — the problem cogmap is built to fight

Chroma's 2025 study tested 18 frontier models and found every single one degrades as context grows — attention dilution, "lost in the middle" effects, distractor interference. This is the empirical foundation for why curated, structured context (like what cogmap assembles) matters more than just throwing files at a model.

- [Context Rot: How Increasing Input Tokens Impacts LLM Performance — Chroma](https://research.trychroma.com/context-rot)
- [Context Engineering Strategies to Prevent Context Rot — Milvus](https://milvus.io/blog/keeping-ai-agents-grounded-context-engineering-strategies-that-prevent-context-rot-using-milvus.md)

---

## 2. Agentic Context Engineering — the emerging discipline

Microsoft Research formalized "ACE" (Agentic Context Engineering): treating context as an *evolving playbook* that accumulates and refines strategies rather than a static dump. Their framing — optimizing context both offline (system prompts) and online (agent memory) — maps closely to cogmap's anchored vs. draft node distinction.

- [Agentic Context Engineering — Microsoft Research / arXiv 2510.04618](https://arxiv.org/abs/2510.04618)
- [Context Engineering: From Prompts to Corporate Multi-Agent Architecture — arXiv 2603.09619](https://arxiv.org/pdf/2603.09619)

---

## 3. Knowledge Graph + LLM Integration

2025 saw KG-LLM fusion reach production maturity. Key patterns: using graph traversal (BFS/DFS, even Monte Carlo Tree Search) to retrieve structured context rather than relying on semantic similarity alone. Cogmap's explicit relationship edges are a form of this — authored graph structure beats hallucinated structure.

- [Unifying LLMs and Knowledge Graphs: A Roadmap — arXiv 2306.08302](https://arxiv.org/abs/2306.08302)
- [KG-LLM Papers — zjukg GitHub](https://github.com/zjukg/KG-LLM-Papers)

---

## 4. Cognitive Dependency — the NYU Tandon concern

2025 research found:
- "Instruct, serve, repeat" dynamics limit deep cognitive engagement
- Combined human-AI performance improves only when AI delegates work to humans, not the reverse
- Junior developers use AI as a substitute; senior engineers use it reflectively

This directly validates cogmap's design decision to make the user the one navigating the map and deciding what context the model sees.

- [How Developers Interact with AI: A Taxonomy — arXiv 2501.08774](https://arxiv.org/abs/2501.08774)
- [Cognitive Atrophy Paradox of AI–Human Interaction — MDPI](https://www.mdpi.com/2078-2489/16/11/1009)
- [Cognitive Challenges in Human-AI Collaboration — Information Systems Research](https://pubsonline.informs.org/doi/10.1287/isre.2021.1079)

---

## What's Missing in the Literature

Most research focuses on retrieval (RAG, vector search) or compression as solutions to context rot. Very little looks at spatial/navigable externalization of project knowledge as a context management strategy — the idea that a human-readable map doubles as a context assembly interface. That gap is where cogmap sits.

---

## Design Principle: Distributed Cognitive Systems

Cogmap should be understood through the lens of **distributed cognition** — a framework from cognitive science (Hutchins, 1995) where intelligence is not located in a single agent but spread across humans, tools, representations, and environments.

The failure mode of most AI-assisted dev tools is full delegation: the LLM holds the model of the system, the LLM navigates, the LLM decides what's relevant. This creates brittleness — when the model is wrong or the context window fills up, there's no fallback because the human has been removed from the loop.

**As designers, the goal is not to build systems that are smarter LLM wrappers. It's to build systems where:**

- The human holds the spatial/structural model (the map)
- The LLM handles traversal and synthesis within a bounded, human-curated context
- The artifact (the map itself) is legible and editable independent of any model

This means cogmap's map viewer is not a UI nicety — it's a cognitive offloading surface. The human's understanding of the project lives in the map, not in the LLM's context window. The LLM is one node in the system, not the system.

**Implications for design:**

- The map must be useful even without Claude running — it's a thinking tool first
- Context assembly should be explicit and inspectable, not automatic and opaque
- The human should always be able to override, redirect, or ignore the model's traversal
- Dependency on any single model or provider is an architectural smell
