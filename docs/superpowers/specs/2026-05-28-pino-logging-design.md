# Pino Logging Design

Production-level structured logging for ScribeKit using Pino, integrated with LangGraph callbacks to trace full pipeline runs.

## Goals

- Full run trace: log input, every agent lifecycle, state at each step, routing decisions, and final output
- Dual output: `pino-pretty` to terminal for readability + structured JSON to `logs/scribekit.log` for searching/grepping
- Scalable for future production log aggregation (add transports without changing logging code)
- Errors visually distinct via log levels (red `ERROR`, yellow `WARN`)
- Structured naming system that scales as agents and tools are added

## Approach: Hybrid — Callback Handler + Node-Level Logging

Two parallel logging paths:

1. **Callback handler** — a custom `BaseCallbackHandler` that receives LLM and tool lifecycle events automatically from LangGraph. Handles the `llm` and `tool` layers.
2. **Node-level logging** — manual Pino child loggers in node wrappers, routing functions, and `generate()`. Handles the `pipeline`, `routing`, and `node` layers.

## Logger Foundation

### Singleton + child logger pattern

`src/logger.ts` exports:

- A singleton Pino instance with dual transports:
  1. **Terminal** — `pino-pretty` for human-readable colorized output to stdout
  2. **File** — structured JSON to `logs/scribekit.log` (auto-created, .gitignored)
- `LOG_LEVEL` env var (defaults to `info`)
- Base context: `{ service: "scribekit" }`
- `createNodeLogger(agent, config)` — creates a child logger stamped with `{ agent, threadId, placeName, destinationName, country }` pulled from `config.configurable`

Each node/routing function imports the helper and creates its own child — no logger passed through `configurable`.

```ts
import { createNodeLogger } from '../logger';

export const identificationNode = async (state: GraphState, config: NodeConfig) => {
  const log = createNodeLogger("identification", config);
  log.info({ event: "node_start" });
  // ...
};
```

Since `layer` and `agent` are always the same for a given logger, `createNodeLogger` bakes them into the child logger's bindings so call sites don't repeat them:

```ts
const log = createNodeLogger("LangGraph::Node", "identification", config);
// layer: "LangGraph::Node" and agent: "identification" are bound on the child
log.info({ event: "node_start" });
// emits: { layer: "LangGraph::Node", agent: "identification", event: "node_start", threadId: "...", ... }
```

For `generate()` in `index.ts`, the singleton is imported directly to create a pipeline-scoped child with `{ layer: "App::Pipeline" }` bound, used for start/end logging and passed to the callback handler.

### Log levels

| Level | Usage |
|-------|-------|
| `info` | All pipeline events: agent lifecycle, state snapshots, prompts, tokens, tool calls, routing |
| `warn` | Degraded paths: image fetch failures, low confidence |
| `error` | Failures: agent errors, tool errors, pipeline errors |

Everything meaningful is at `info` — nothing hidden behind `debug`.

### Log field ordering

Every log line follows: **location → status → data**

```ts
logger.info({
  layer: "App::Node",
  agent: "image-analysis",
  event: "image_fetch",
  status: "error",
  url: "https://...",
  reason: "MIME type not allowed: text/html",
});
```

`pino-pretty` renders fields in this order via `messageFormat`.

## Structured Naming: Layers and Events

### Predefined layers

Two namespaces: `LangGraph::` for framework lifecycle events, `App::` for custom application logic.

| Layer | Origin | Description |
|-------|--------|-------------|
| `App::Pipeline` | manual | Overall pipeline lifecycle in `generate()` |
| `App::Routing` | manual | Conditional edge decisions in routing functions |
| `App::Node` | manual | Custom business logic inside node wrappers (image fetching, filtering, etc.) |
| `App::CLI` | manual | CLI application layer in `cli.ts` |
| `LangGraph::Node` | manual | LangGraph node lifecycle (enter, exit, state return) |
| `LangGraph::LLM` | callback | LLM/ChatModel calls, auto-fired by LangGraph callbacks |
| `LangGraph::Tool` | callback | Tool calls, auto-fired by LangGraph callbacks |

### Events per layer

Every event name is self-describing — readable without the layer context.

**`App::Pipeline`** (manual)

| Event | Meaning | Payload |
|-------|---------|---------|
| `pipeline_start` | `generate()` entered | placeName, destinationName, country, imageUrls count, notes (truncated) |
| `pipeline_end` | `generate()` returning | duration, confidence, error count, success/failure |

**`App::Routing`** (manual)

| Event | Meaning | Payload |
|-------|---------|---------|
| `routing_decision` | Conditional edge evaluated | from, to, reason, skipped[] (all paths not taken) |

**`App::Node`** (manual — custom business logic inside nodes)

| Event | Meaning | Payload |
|-------|---------|---------|
| `image_fetch` | Per-image HTTP fetch | url, status (success/error), mediaType, bytes, or error reason |
| `image_filter` | Per-image keep/reject | url, keep (bool), reason |

Agent-specific events. New agents may add new event names as needed.

**`App::CLI`** (manual)

| Event | Meaning | Payload |
|-------|---------|---------|
| `input_loaded` | CLI parsed input file | placeName, destinationName, imageCount |
| `output_written` | CLI wrote result file | path |
| `failed` | CLI encountered errors | errors[] |

**`LangGraph::Node`** (manual — LangGraph node lifecycle)

| Event | Meaning | Payload |
|-------|---------|---------|
| `node_start` | LangGraph node function entered | agent name |
| `node_end` | LangGraph node function returned | agent name, duration |
| `state_update` | State delta returned to LangGraph | full state delta (large strings truncated with char count) |

**`LangGraph::LLM`** (callback)

| Event | Meaning | Payload |
|-------|---------|---------|
| `llm_start` | LangGraph callback: ChatModel invoked | model name, prompt/messages content |
| `llm_end` | LangGraph callback: ChatModel returned | response content, token usage (input/output/cache), latency |
| `llm_error` | LangGraph callback: ChatModel failed | error message, model name |

**`LangGraph::Tool`** (callback)

| Event | Meaning | Payload |
|-------|---------|---------|
| `tool_start` | LangGraph callback: tool invoked | tool name, input arguments |
| `tool_end` | LangGraph callback: tool returned | tool name, output (truncated) |
| `tool_error` | LangGraph callback: tool failed | tool name, error message |

### Scalability

- New agent → new `agent` field value, same layers work
- New tool → shows up automatically via callback handler under `LangGraph::Tool`
- New node-level custom operation → new event name in `App::Node`
- New app-level layer (future: `App::Metrics`, `App::Cache`) → add to `App::` namespace
- New framework integration → add to `LangGraph::` namespace

## Callback Handler

`src/logging/callback-handler.ts` — a class extending `BaseCallbackHandler` from `@langchain/core`.

Handles these callbacks:

| Callback | Layer | Event |
|----------|-------|-------|
| `handleChatModelStart` | `LangGraph::LLM` | `llm_start` — model name, messages content |
| `handleLLMEnd` | `LangGraph::LLM` | `llm_end` — response content, token usage, latency |
| `handleLLMError` | `LangGraph::LLM` | `llm_error` — error details |
| `handleToolStart` | `LangGraph::Tool` | `tool_start` — tool name, input arguments |
| `handleToolEnd` | `LangGraph::Tool` | `tool_end` — tool output (truncated) |
| `handleToolError` | `LangGraph::Tool` | `tool_error` — error details |

The handler derives the current `agent` name from LangGraph's nested run chain (graph → node → agent → llm/tool) by tracking the active node name from `handleChainStart` events. It sets `layer` to `LangGraph::LLM` or `LangGraph::Tool` accordingly.

Connected via `graph.invoke()`:

```ts
const handler = new PinoCallbackHandler(pipelineLogger);
await graph.invoke({}, { callbacks: [handler], configurable: { ... } });
```

LangGraph propagates the handler to every agent and tool automatically.

## Node-Level Logging

### `App::Pipeline` — `generate()` in `index.ts`

```
INFO App::Pipeline │ pipeline_start │ { placeName: "Cafe Lomi", destinationName: "Paris", country: "France", imageCount: 3 }
...
INFO App::Pipeline │ pipeline_end   │ { duration: 12.4s, confidence: "HIGH", errors: 0 }
```

### `App::Routing` — `routeAfterStart()` and `routeAfterIdentification()` in `graph.ts`

```
INFO App::Routing │ routing_decision │ { from: "__start__", to: "image-analysis-agent", reason: "imageUrls: 3", skipped: ["identification-agent"] }
INFO App::Routing │ routing_decision │ { from: "identification-agent", to: "research-agent", reason: "confidence: HIGH", skipped: ["__end__"] }
```

Or on the failure path:

```
WARN App::Routing │ routing_decision │ { from: "identification-agent", to: "__end__", reason: "confidence: LOW", skipped: ["research-agent"] }
```

### `App::Node` — per-image logging in image analysis

Each image gets its own fetch log:

```
INFO App::Node │ image-analysis │ image_fetch  │ { url: "https://.../cafe.jpg", status: "success", mediaType: "image/jpeg", bytes: 245120 }
INFO App::Node │ image-analysis │ image_fetch  │ { url: "https://.../menu.png", status: "success", mediaType: "image/png", bytes: 189400 }
WARN App::Node │ image-analysis │ image_fetch  │ { url: "https://.../page", status: "error", reason: "MIME type not allowed: text/html" }
```

Each image gets its own filter decision:

```
INFO App::Node │ image-analysis │ image_filter │ { url: "https://.../cafe.jpg", keep: true, reason: "Shows storefront with signage" }
INFO App::Node │ image-analysis │ image_filter │ { url: "https://.../menu.png", keep: false, reason: "Menu closeup, not useful for identification" }
```

### `LangGraph::Node` — state updates (all nodes)

Each node logs its full state delta on return:

```
INFO LangGraph::Node │ image-analysis  │ state_update │ { visualSummary: "...", identificationCues: "...", filteredImageUrls: [...], errors: [...] }
INFO LangGraph::Node │ identification  │ state_update │ { confidence: "HIGH", placeDetails: { placeName: "Cafe Lomi", address: "..." } }
INFO LangGraph::Node │ research        │ state_update │ { researchNotes: "...(2340 chars)", researchSources: ["url1", "url2"] }
INFO LangGraph::Node │ editorial       │ state_update │ { editorialContent: { tagline: "...", description: "...(890 chars)", ... } }
```

Large string fields truncated with char count.

### `App::CLI` — `cli.ts`

Replace existing `console.log` and `console.error` with Pino:

```
INFO App::CLI │ input_loaded   │ { placeName: "Cafe Lomi", destinationName: "Paris", imageCount: 3 }
INFO App::CLI │ output_written │ { path: "result.json" }
ERROR App::CLI │ failed        │ { errors: ["Place could not be confirmed (confidence: LOW)"] }
```

## Wiring

### Path 1: Callback handler (`LangGraph::LLM` + `LangGraph::Tool` layers)

Created in `generate()`, passed via LangGraph's `callbacks` option. LangGraph propagates automatically — no per-agent wiring.

### Path 2: Manual logging (`App::*` + `LangGraph::Node` layers)

Each function imports `createNodeLogger` from `src/logger.ts` and creates a child from `config.configurable`. No logger passed through configurable.

## image-fetcher.ts refactor

`fetchImages()` currently returns `{ images, errors }` as split arrays. Refactor to return per-image results with full detail:

```ts
interface ImageFetchResult {
  url: string;
  status: "success" | "error";
  image?: FetchedImage;       // present on success
  mediaType?: string;         // present on success
  bytes?: number;             // present on success
  reason?: string;            // present on error
}
```

This enables per-image logging in the node wrapper.

## File changes

| File | Change |
|------|--------|
| `src/logger.ts` | **New.** Singleton Pino instance, `createNodeLogger()`, layer/event type definitions |
| `src/logging/callback-handler.ts` | **New.** `PinoCallbackHandler` extending `BaseCallbackHandler` |
| `src/index.ts` | Create callback handler, pass to `graph.invoke()`, log pipeline start/end |
| `src/graph.ts` | Add routing decision logging to `routeAfterStart()` and `routeAfterIdentification()` |
| `src/agents/image-analysis-agent.ts` | Replace `console.log`, add per-image fetch/filter logs, state_update |
| `src/agents/identification-agent.ts` | Replace `console.log`, add state_update |
| `src/agents/research-agent.ts` | Replace `console.log`, add state_update |
| `src/agents/editorial-agent.ts` | Replace `console.log`, add state_update |
| `src/cli.ts` | Replace `console.log`/`console.error` with Pino |
| `src/helpers/image-fetcher.ts` | Return per-image results instead of split arrays |
| `package.json` | Add `pino`, `pino-pretty` (dev dep) |
| `.env.example` | Add `LOG_LEVEL` |
| `.gitignore` | Add `logs/` |

## Example full trace

```
INFO  App::Pipeline    │                │ pipeline_start    │ { placeName: "Cafe Lomi", destinationName: "Paris", ... }
INFO  App::Routing     │                │ routing_decision  │ → image-analysis-agent (skipped: ["identification-agent"])
INFO  LangGraph::Node  │ image-analysis │ node_start        │
INFO  App::Node        │ image-analysis │ image_fetch       │ { url: "...jpg", status: "success", bytes: 245120 }
INFO  App::Node        │ image-analysis │ image_fetch       │ { url: "...png", status: "success", bytes: 189400 }
WARN  App::Node        │ image-analysis │ image_fetch       │ { url: "...html", status: "error", reason: "MIME..." }
INFO  LangGraph::LLM   │ image-analysis │ llm_start         │ { model: "claude-haiku-4-5", messages: [...] }
INFO  LangGraph::LLM   │ image-analysis │ llm_end           │ { tokens: { in: 1200, out: 450 }, latency: 2.3s }
INFO  App::Node        │ image-analysis │ image_filter      │ { url: "...jpg", keep: true, reason: "..." }
INFO  App::Node        │ image-analysis │ image_filter      │ { url: "...png", keep: false, reason: "..." }
INFO  LangGraph::Node  │ image-analysis │ state_update      │ { visualSummary: "...", filteredImageUrls: [...] }
INFO  LangGraph::Node  │ image-analysis │ node_end          │ { duration: 3.1s }
INFO  LangGraph::Node  │ identification │ node_start        │
INFO  LangGraph::LLM   │ identification │ llm_start         │ { model: "claude-haiku-4-5", messages: [...] }
INFO  LangGraph::Tool  │ identification │ tool_start        │ { tool: "google_places", input: { query: "Cafe Lomi Paris" } }
INFO  LangGraph::Tool  │ identification │ tool_end          │ { tool: "google_places", candidates: 2 }
INFO  LangGraph::LLM   │ identification │ llm_end           │ { tokens: { in: 800, out: 300 }, latency: 1.1s }
INFO  LangGraph::Node  │ identification │ state_update      │ { confidence: "HIGH", placeDetails: { ... } }
INFO  LangGraph::Node  │ identification │ node_end          │ { duration: 2.5s }
INFO  App::Routing     │                │ routing_decision  │ → research-agent (confidence: HIGH, skipped: ["__end__"])
INFO  LangGraph::Node  │ research       │ node_start        │
INFO  LangGraph::LLM   │ research       │ llm_start         │ { model: "claude-haiku-4-5", messages: [...] }
INFO  LangGraph::Tool  │ research       │ tool_start        │ { tool: "fetch_url", input: { url: "https://..." } }
INFO  LangGraph::Tool  │ research       │ tool_end          │ { tool: "fetch_url", chars: 12400 }
INFO  LangGraph::Tool  │ research       │ tool_start        │ { tool: "fetch_url", input: { url: "https://..." } }
INFO  LangGraph::Tool  │ research       │ tool_end          │ { tool: "fetch_url", chars: 8900 }
INFO  LangGraph::LLM   │ research       │ llm_end           │ { tokens: { in: 2100, out: 600 }, latency: 3.2s }
INFO  LangGraph::Node  │ research       │ state_update      │ { researchNotes: "...(2340 chars)", researchSources: [...] }
INFO  LangGraph::Node  │ research       │ node_end          │ { duration: 4.8s }
INFO  LangGraph::Node  │ editorial      │ node_start        │
INFO  LangGraph::LLM   │ editorial      │ llm_start         │ { model: "claude-sonnet-4-6", messages: [...] }
INFO  LangGraph::LLM   │ editorial      │ llm_end           │ { tokens: { in: 3200, out: 1800 }, latency: 4.1s }
INFO  LangGraph::Node  │ editorial      │ state_update      │ { editorialContent: { tagline: "...", ... } }
INFO  LangGraph::Node  │ editorial      │ node_end          │ { duration: 4.3s }
INFO  App::Pipeline    │                │ pipeline_end      │ { duration: 14.7s, confidence: "HIGH", errors: 0 }
```
