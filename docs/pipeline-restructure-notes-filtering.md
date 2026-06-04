# Pipeline Restructure + Notes Filtering

## Motivation

Identification is the pipeline gate — if it fails (LOW/NONE confidence), all other work is wasted. Image analysis (vision model with base64 images) is the most expensive early node. Running identification first and fanning out only on success avoids unnecessary cost.

## New pipeline

```
START → identification-agent
identification-agent → [notes-filter-agent, image-analysis-agent, research-agent] in parallel (if PASSING_CONFIDENCE)
identification-agent → END (if LOW/NONE confidence)
[notes-filter-agent, image-analysis-agent, research-agent] → editorial-agent → END
```

- The current conditional START edge (check for imageUrls before routing to image-analysis) is removed. `imageAnalysisNode` already handles empty imageUrls gracefully.
- Research fans out immediately after identification passes — it only needs `placeDetails` from state, not image-analysis or notes-filter results.
- Editorial waits for all three parallel nodes to complete before running.

## Notes filter agent

- New LLM-based graph node (`notes-filter-agent`) using `claude-haiku-4-5-20251001`
- Reads raw notes from `configurable.notes`, strips content that isn't about the place, writes `filteredNotes` to state
- `configurable.notes` is consumed exclusively by this node and never read downstream — all agents that need notes read `state.filteredNotes`
- If notes is empty/null, returns `filteredNotes: ""` immediately

## State changes

- Add `filteredNotes: Annotation<string>` to `State`
- Editorial node reads `state.filteredNotes` instead of `config.configurable.notes`

## Deferred: reconciliation agent

A reconciliation agent between research and editorial (receiving `filteredNotes`, `visualSummary`, `researchNotes`) was considered to handle cross-source conflicts (e.g. notes contradict research, visual summary is a partial view of the venue). Deferred until testing reveals this is a real output quality problem — notes filtering eliminates the worst inputs, and editorial already treats notes as unverified. Revisit if editorial outputs show systematic source conflict issues.
