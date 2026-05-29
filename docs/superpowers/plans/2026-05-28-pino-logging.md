# Pino Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-level structured logging with Pino throughout the ScribeKit pipeline, using a hybrid approach of LangGraph callback handler (LLM/tool events) and manual node-level logging (pipeline/routing/node events).

**Architecture:** Two parallel logging paths — a `PinoCallbackHandler` extending `BaseTracer` auto-captures LLM and tool lifecycle events (`LangGraph::LLM`, `LangGraph::Tool`), while manual Pino child loggers in node wrappers, routing functions, and `generate()` handle business-level events (`App::Pipeline`, `App::Routing`, `App::Node`, `App::CLI`, `LangGraph::Node`). A singleton Pino instance with dual transports (pino-pretty to terminal, JSON to file) provides the foundation. Child loggers bind run context (threadId, placeName, etc.) so call sites only pass event-specific data.

**Tech Stack:** pino, pino-pretty, @langchain/core BaseTracer

**Spec:** `docs/superpowers/specs/2026-05-28-pino-logging-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/logger.ts` | Create | Singleton Pino instance, layer/event types, `createNodeLogger()`, `createPipelineLogger()`, `truncateStrings()` |
| `src/logging/callback-handler.ts` | Create | `PinoCallbackHandler` extending `BaseTracer` — logs LLM and tool events |
| `src/helpers/image-fetcher.ts` | Modify | Refactor `fetchImages()` to return per-image results with status/detail |
| `src/index.ts` | Modify | Create pipeline logger + callback handler, wire into `graph.invoke()`, log pipeline start/end |
| `src/graph.ts` | Modify | Add routing decision logging to both routing functions |
| `src/agents/image-analysis-agent.ts` | Modify | Replace `console.log`, add `LangGraph::Node` + `App::Node` logging |
| `src/agents/identification-agent.ts` | Modify | Replace `console.log`, add `LangGraph::Node` logging |
| `src/agents/research-agent.ts` | Modify | Replace `console.log`, add `LangGraph::Node` logging |
| `src/agents/editorial-agent.ts` | Modify | Replace `console.log`, add `LangGraph::Node` logging |
| `src/cli.ts` | Modify | Replace `console.log`/`console.error` with `App::CLI` logging |
| `package.json` | Modify | Add `pino`, `pino-pretty` dependencies |
| `.env.example` | Modify | Add `LOG_LEVEL` |
| `.gitignore` | Modify | Add `logs/` |

---

### Task 1: Install Dependencies and Configuration

**Files:**
- Modify: `package.json`
- Modify: `.gitignore:1-6`
- Modify: `.env.example:1-2`

- [ ] **Step 1: Install pino and pino-pretty**

Run: `npm install pino pino-pretty`

Expected: Both packages added to `dependencies` in `package.json`.

- [ ] **Step 2: Add `logs/` to `.gitignore`**

```gitignore
node_modules/
dist/
.env
*.tgz
CLAUDE.local.md
logs/
```

- [ ] **Step 3: Add `LOG_LEVEL` to `.env.example`**

```
ANTHROPIC_API_KEY=
GOOGLE_PLACES_API_KEY=
LOG_LEVEL=info
```

- [ ] **Step 4: Verify install**

Run: `npm ls pino pino-pretty`

Expected: Both packages listed without errors.

---

### Task 2: Logger Foundation

**Files:**
- Create: `src/logger.ts`

**Context:** This is the singleton Pino instance used by the entire application. It exports the base logger, helper functions to create child loggers, and type definitions for layers/events. Child loggers bind `layer`, `agent`, and run context (threadId, placeName, destinationName, country) so call sites only pass event-specific fields.

- [ ] **Step 1: Create `src/logger.ts`**

```ts
import pino from "pino";
import type { NodeConfig } from "./state";

export const LAYERS = [
  "App::Pipeline",
  "App::Routing",
  "App::Node",
  "App::CLI",
  "LangGraph::Node",
  "LangGraph::LLM",
  "LangGraph::Tool",
] as const;

export type Layer = (typeof LAYERS)[number];

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "scribekit" },
  transport: {
    targets: [
      {
        target: "pino-pretty",
        options: {
          messageFormat: "{layer} │ {agent} │ {event}",
          ignore: "pid,hostname,service,layer,agent,event,threadId,placeName,destinationName,country",
          colorize: true,
        },
      },
      {
        target: "pino/file",
        options: { destination: "./logs/scribekit.log", mkdir: true },
      },
    ],
  },
});

export function createPipelineLogger(parsed: {
  placeName: string;
  destinationName: string;
  country: string;
}): pino.Logger {
  return logger.child({
    layer: "App::Pipeline" as Layer,
    agent: "",
    threadId: `${parsed.placeName}--${parsed.destinationName}`,
    placeName: parsed.placeName,
    destinationName: parsed.destinationName,
    country: parsed.country,
  });
}

export function createNodeLogger(
  layer: Layer,
  agent: string | null,
  config: NodeConfig,
): pino.Logger {
  const c = config.configurable ?? {};
  return logger.child({
    layer,
    agent: agent ?? "",
    threadId: (c.thread_id as string) ?? "",
    placeName: (c.placeName as string) ?? "",
    destinationName: (c.destinationName as string) ?? "",
    country: (c.country as string) ?? "",
  });
}

const MAX_STRING_LENGTH = 200;

export function truncateStrings(
  obj: Record<string, unknown>,
  maxLen = MAX_STRING_LENGTH,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && value.length > maxLen) {
      result[key] = `${value.slice(0, maxLen)}...(${value.length} chars)`;
    } else if (Array.isArray(value)) {
      result[key] = value;
    } else if (typeof value === "object" && value !== null) {
      result[key] = truncateStrings(value as Record<string, unknown>, maxLen);
    } else {
      result[key] = value;
    }
  }
  return result;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/logger.ts`

Expected: No errors.

---

### Task 3: Callback Handler

**Files:**
- Create: `src/logging/callback-handler.ts`

**Context:** This handler extends `BaseTracer` from `@langchain/core` (the same base class as `ConsoleCallbackHandler`). `BaseTracer` maintains a `runMap` that tracks parent/child run relationships. We use this to walk up the ancestor chain and find the LangGraph node name (e.g., "identification-agent") so each LLM/tool log line includes the agent it belongs to. The handler receives a base Pino logger (the pipeline logger from `generate()`) and adds `layer`, `agent`, and event-specific fields per log call.

Reference implementation: `node_modules/@langchain/core/dist/tracers/console.js` — see `getParents()` and `getBreadcrumbs()`.

- [ ] **Step 1: Create `src/logging/` directory**

Run: `mkdir -p src/logging`

- [ ] **Step 2: Create `src/logging/callback-handler.ts`**

```ts
import type pino from "pino";
import { BaseTracer, type Run } from "@langchain/core/tracers/base";

const MAX_OUTPUT_LENGTH = 500;

function truncateOutput(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_OUTPUT_LENGTH) {
    return `${value.slice(0, MAX_OUTPUT_LENGTH)}...(${value.length} chars)`;
  }
  return value;
}

function elapsed(run: Run): string {
  if (!run.end_time) return "";
  const ms = run.end_time - run.start_time;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export class PinoCallbackHandler extends BaseTracer {
  name = "pino_callback_handler";
  private baseLogger: pino.Logger;

  constructor(baseLogger: pino.Logger) {
    super();
    this.baseLogger = baseLogger;
  }

  protected persistRun(_run: Run): Promise<void> {
    return Promise.resolve();
  }

  private resolveAgentName(run: Run): string {
    let current: Run | undefined = run;
    while (current?.parent_run_id) {
      const parent = this.runMap.get(current.parent_run_id);
      if (!parent) break;
      if (parent.name?.endsWith("-agent")) {
        return parent.name.replace(/-agent$/, "");
      }
      current = parent;
    }
    return "unknown";
  }

  onLLMStart(run: Run): void {
    const agent = this.resolveAgentName(run);
    this.baseLogger.info({
      layer: "LangGraph::LLM",
      agent,
      event: "llm_start",
      model: run.name,
      messages: run.inputs,
    });
  }

  onLLMEnd(run: Run): void {
    const agent = this.resolveAgentName(run);
    const tokenUsage = run.outputs?.llmOutput?.tokenUsage ?? run.outputs?.llmOutput?.usage ?? {};
    this.baseLogger.info({
      layer: "LangGraph::LLM",
      agent,
      event: "llm_end",
      model: run.name,
      latency: elapsed(run),
      tokens: tokenUsage,
      response: truncateOutput(
        run.outputs?.generations?.[0]?.[0]?.text ??
        run.outputs?.generations?.[0]?.[0]?.message?.content ??
        "",
      ),
    });
  }

  onLLMError(run: Run): void {
    const agent = this.resolveAgentName(run);
    this.baseLogger.error({
      layer: "LangGraph::LLM",
      agent,
      event: "llm_error",
      model: run.name,
      error: run.error,
    });
  }

  onToolStart(run: Run): void {
    const agent = this.resolveAgentName(run);
    this.baseLogger.info({
      layer: "LangGraph::Tool",
      agent,
      event: "tool_start",
      tool: run.name,
      input: run.inputs,
    });
  }

  onToolEnd(run: Run): void {
    const agent = this.resolveAgentName(run);
    this.baseLogger.info({
      layer: "LangGraph::Tool",
      agent,
      event: "tool_end",
      tool: run.name,
      output: truncateOutput(run.outputs?.output),
    });
  }

  onToolError(run: Run): void {
    const agent = this.resolveAgentName(run);
    this.baseLogger.error({
      layer: "LangGraph::Tool",
      agent,
      event: "tool_error",
      tool: run.name,
      error: run.error,
    });
  }

  onChainStart(_run: Run): void {}
  onChainEnd(_run: Run): void {}
  onChainError(_run: Run): void {}
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit src/logging/callback-handler.ts`

Expected: No errors. Note: `this.runMap` is deprecated in the types but is still functional and used by the built-in `ConsoleCallbackHandler`. If the compiler warns, suppress with a `// @ts-expect-error` on the access or cast through `(this as any).runMap`.

---

### Task 4: Refactor image-fetcher.ts

**Files:**
- Modify: `src/helpers/image-fetcher.ts:67-82`

**Context:** Currently `fetchImages()` returns `{ images: FetchedImage[], errors: string[] }` — split arrays with no per-image correlation. Refactor to return `ImageFetchResult[]` with per-image status, so the image-analysis node can log each image individually. The `fetchImage()` function (singular) stays unchanged. Only `fetchImages()` (plural) and its return type change.

- [ ] **Step 1: Add `ImageFetchResult` interface and refactor `fetchImages()`**

Add the interface after `FetchedImage`:

```ts
export interface ImageFetchResult {
  url: string;
  status: "success" | "error";
  image?: FetchedImage;
  mediaType?: string;
  bytes?: number;
  reason?: string;
}
```

Replace the `fetchImages` function (lines 67-82) with:

```ts
export async function fetchImages(urls: string[]): Promise<ImageFetchResult[]> {
  const results = await Promise.allSettled(urls.map(fetchImage));

  return results.map((result, i) => {
    if (result.status === "fulfilled") {
      const img = result.value;
      return {
        url: urls[i],
        status: "success" as const,
        image: img,
        mediaType: img.mediaType,
        bytes: Buffer.byteLength(img.base64, "base64"),
      };
    }
    return {
      url: urls[i],
      status: "error" as const,
      reason: result.reason.message,
    };
  });
}
```

- [ ] **Step 2: Verify the helper test still passes**

Run: `node --test --experimental-strip-types src/helpers/image-fetcher.test.ts`

Expected: Tests pass. If they relied on the old `{ images, errors }` shape, update them to use the new `ImageFetchResult[]` shape — successful results have `result.image`, errors have `result.reason`.

- [ ] **Step 3: Verify no type errors**

Run: `npx tsc --noEmit`

Expected: Type error in `src/agents/image-analysis-agent.ts` because it uses the old `{ images, errors }` return type. This is expected and will be fixed in Task 7.

---

### Task 5: Pipeline Logging and Callback Handler Wiring

**Files:**
- Modify: `src/index.ts:1-65`

**Context:** `generate()` is the pipeline entry point. It creates the pipeline logger, the callback handler, logs `pipeline_start`/`pipeline_end`, and passes the callback handler to `graph.invoke()` via the `callbacks` option. LangGraph auto-propagates the handler to all agents and tools.

- [ ] **Step 1: Update `src/index.ts`**

Add imports at the top:

```ts
import { createPipelineLogger, truncateStrings } from "./logger";
import { PinoCallbackHandler } from "./logging/callback-handler";
```

Replace the `generate` function body with:

```ts
export async function generate(input: GenerateInput): Promise<GenerateResult> {
  const parsed = Context.parse(input);
  const pipelineLog = createPipelineLogger(parsed);
  const callbackHandler = new PinoCallbackHandler(pipelineLog);

  pipelineLog.info({
    event: "pipeline_start",
    placeName: parsed.placeName,
    destinationName: parsed.destinationName,
    country: parsed.country,
    imageCount: parsed.imageUrls?.length ?? 0,
    notes: parsed.notes ? `${parsed.notes.slice(0, 100)}${parsed.notes.length > 100 ? "..." : ""}` : null,
  });

  const startTime = Date.now();

  const result = await graph.invoke(
    {},
    {
      callbacks: [callbackHandler],
      configurable: { thread_id: `${parsed.placeName}--${parsed.destinationName}`, ...parsed },
    },
  );

  const placeDetails = result.placeDetails;
  const output: GenerateResult = {
    placeName: placeDetails?.placeName ?? parsed.placeName,
    destinationName: placeDetails?.destinationName ?? parsed.destinationName,
    country: placeDetails?.country ?? parsed.country,
    address: placeDetails?.address ?? parsed.address ?? "",
    latitude: placeDetails?.latitude ?? 0,
    longitude: placeDetails?.longitude ?? 0,
    phone: placeDetails?.phone ?? null,
    website: placeDetails?.website ?? null,
    priceLevel: placeDetails?.priceLevel ?? null,
    openingHours: placeDetails?.openingHours ?? null,
    accessibilityOptions: placeDetails?.accessibilityOptions ?? null,
    confidence: result.confidence as ConfidenceLevel,
    researchNotes: result.researchNotes,
    researchSources: result.researchSources,
    editorialContent: result.editorialContent,
    filteredImageUrls: result.filteredImageUrls,
    errors: result.errors,
    generatedAt: new Date().toISOString(),
  };

  const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

  if (output.errors.length > 0) {
    pipelineLog.warn({
      event: "pipeline_end",
      duration,
      confidence: output.confidence,
      errorCount: output.errors.length,
      errors: output.errors,
    });
  } else {
    pipelineLog.info({
      event: "pipeline_end",
      duration,
      confidence: output.confidence,
      errorCount: 0,
    });
  }

  return output;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/index.ts`

Expected: No errors (aside from the image-analysis-agent issue from Task 4).

---

### Task 6: Routing Decision Logging

**Files:**
- Modify: `src/graph.ts:1-31`

**Context:** The two routing functions (`routeAfterStart`, `routeAfterIdentification`) are plain functions called by LangGraph's conditional edges. They need to log `routing_decision` events with `from`, `to`, `reason`, and `skipped[]`. `routeAfterIdentification` currently only takes `state` — add `config` parameter so it can create a logger. The `__end__` route on low confidence logs at `warn` level.

- [ ] **Step 1: Update `src/graph.ts`**

Replace the entire file with:

```ts
import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { imageAnalysisNode } from "./agents/image-analysis-agent";
import { identificationNode } from "./agents/identification-agent";
import { researchNode } from "./agents/research-agent";
import { editorialNode } from "./agents/editorial-agent";
import { PASSING_CONFIDENCE, type ConfidenceLevel } from "./context";
import { State, type GraphState, type NodeConfig } from "./state";
import { createNodeLogger } from "./logger";

function routeAfterStart(_state: GraphState, config: NodeConfig): string {
  const log = createNodeLogger("App::Routing", null, config);
  const imageUrls = (config.configurable?.imageUrls as string[]) ?? [];

  if (imageUrls.length > 0) {
    log.info({
      event: "routing_decision",
      from: "__start__",
      to: "image-analysis-agent",
      reason: `imageUrls: ${imageUrls.length}`,
      skipped: ["identification-agent"],
    });
    return "image-analysis-agent";
  }

  log.info({
    event: "routing_decision",
    from: "__start__",
    to: "identification-agent",
    reason: "no imageUrls",
    skipped: ["image-analysis-agent"],
  });
  return "identification-agent";
}

function routeAfterIdentification(state: GraphState, config: NodeConfig): string {
  const log = createNodeLogger("App::Routing", null, config);
  const confidence = state.confidence as ConfidenceLevel;

  if (PASSING_CONFIDENCE.has(confidence)) {
    log.info({
      event: "routing_decision",
      from: "identification-agent",
      to: "research-agent",
      reason: `confidence: ${confidence}`,
      skipped: ["__end__"],
    });
    return "research-agent";
  }

  log.warn({
    event: "routing_decision",
    from: "identification-agent",
    to: "__end__",
    reason: `confidence: ${confidence}`,
    skipped: ["research-agent"],
  });
  return "__end__";
}

const workflow = new StateGraph(State)
  .addNode("image-analysis-agent", imageAnalysisNode, { retryPolicy: { maxAttempts: 1 } })
  .addNode("identification-agent", identificationNode, { retryPolicy: { maxAttempts: 1 } })
  .addNode("research-agent", researchNode, { retryPolicy: { maxAttempts: 1 } })
  .addNode("editorial-agent", editorialNode, { retryPolicy: { maxAttempts: 1 } })
  .addConditionalEdges(START, routeAfterStart)
  .addEdge("image-analysis-agent", "identification-agent")
  .addConditionalEdges("identification-agent", routeAfterIdentification)
  .addEdge("research-agent", "editorial-agent")
  .addEdge("editorial-agent", END);

const checkpointer = new MemorySaver();

export const graph = workflow.compile({ checkpointer });
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/graph.ts`

Expected: No errors.

---

### Task 7: Image Analysis Agent Logging

**Files:**
- Modify: `src/agents/image-analysis-agent.ts:47-87`

**Context:** This is the most complex agent to update because it uses both `LangGraph::Node` (node lifecycle, state_update) and `App::Node` (per-image fetch and filter events). It also needs to consume the new `ImageFetchResult[]` return type from `fetchImages()`. Failed image fetches log at `warn`, successful ones at `info`.

- [ ] **Step 1: Update `src/agents/image-analysis-agent.ts`**

Replace the `imageAnalysisNode` function (lines 47-87) with:

```ts
export const imageAnalysisNode = async (_state: GraphState, config: NodeConfig) => {
  const lgLog = createNodeLogger("LangGraph::Node", "image-analysis", config);
  const appLog = createNodeLogger("App::Node", "image-analysis", config);
  const imageUrls: string[] = (config.configurable?.imageUrls as string[]) ?? [];

  lgLog.info({ event: "node_start" });

  if (imageUrls.length === 0) {
    const stateUpdate = { visualSummary: "", identificationCues: "", filteredImageUrls: [] };
    lgLog.info({ event: "state_update", ...stateUpdate });
    lgLog.info({ event: "node_end" });
    return stateUpdate;
  }

  const startTime = Date.now();
  const fetchResults = await fetchImages(imageUrls);

  for (const r of fetchResults) {
    if (r.status === "success") {
      appLog.info({ event: "image_fetch", url: r.url, status: r.status, mediaType: r.mediaType, bytes: r.bytes });
    } else {
      appLog.warn({ event: "image_fetch", url: r.url, status: r.status, reason: r.reason });
    }
  }

  const fetchedImages = fetchResults.filter((r) => r.status === "success" && r.image).map((r) => r.image!);
  const fetchErrors = fetchResults.filter((r) => r.status === "error").map((r) => `${r.url}: ${r.reason}`);

  if (fetchedImages.length === 0) {
    const stateUpdate = { visualSummary: "", identificationCues: "", filteredImageUrls: [], errors: fetchErrors };
    lgLog.info({ event: "state_update", ...truncateStrings(stateUpdate) });
    lgLog.info({ event: "node_end", duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` });
    return stateUpdate;
  }

  const result = await imageAnalysisAgent.invoke({
    messages: [buildImageMessage(fetchedImages)],
  });

  const response = result.structuredResponse;
  const kept = response.images.filter((img: ImageResult) => img.keep);

  for (const img of response.images) {
    appLog.info({ event: "image_filter", url: img.url, keep: img.keep, reason: img.reason });
  }

  const stateUpdate = {
    visualSummary: kept.map((img: ImageResult) => img.visualSummary).filter(Boolean).join("\n\n"),
    identificationCues: kept.map((img: ImageResult) => img.identificationCues).filter(Boolean).join("\n\n"),
    filteredImageUrls: kept.map((img: ImageResult) => img.url),
    errors: fetchErrors,
  };

  lgLog.info({ event: "state_update", ...truncateStrings(stateUpdate) });
  lgLog.info({ event: "node_end", duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` });

  return stateUpdate;
};
```

Add imports at the top of the file:

```ts
import { createNodeLogger, truncateStrings } from "../logger";
```

Remove the `fetchImages` destructuring import and update to just import `fetchImages` (the type `FetchedImage` is still needed for `buildImageMessage`):

```ts
import { fetchImages, type FetchedImage } from "../helpers/image-fetcher";
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/agents/image-analysis-agent.ts`

Expected: No errors. All `console.log` calls are removed.

---

### Task 8: Identification, Research, and Editorial Agent Logging

**Files:**
- Modify: `src/agents/identification-agent.ts:40-77`
- Modify: `src/agents/research-agent.ts:26-54`
- Modify: `src/agents/editorial-agent.ts:64-92`

**Context:** These three agents follow the same pattern: replace `console.log` with `LangGraph::Node` logging for `node_start`, `node_end`, and `state_update`. No `App::Node` events needed (unlike image-analysis).

- [ ] **Step 1: Update `src/agents/identification-agent.ts`**

Add import at top:

```ts
import { createNodeLogger, truncateStrings } from "../logger";
```

Replace the `identificationNode` function (lines 40-77) with:

```ts
export const identificationNode = async (state: GraphState, config: NodeConfig) => {
  const log = createNodeLogger("LangGraph::Node", "identification", config);
  log.info({ event: "node_start" });
  const startTime = Date.now();

  const { placeName, destinationName, country, address } = config.configurable ?? {};
  const identificationCues = state.identificationCues || "";

  let userMessage = `Identify and confirm this place: "${placeName}" in ${destinationName}, ${country}`;
  if (address) {
    userMessage += `\nAddress hint: ${address}`;
  }
  if (identificationCues) {
    userMessage += `\nIdentification cues from photos: ${identificationCues}`;
  }

  const result = await identificationAgent.invoke({
    messages: [{
      role: "user",
      content: userMessage,
    }],
  });

  const response = result.structuredResponse;

  if (!PASSING_CONFIDENCE.has(response.confidence)) {
    const stateUpdate = {
      confidence: response.confidence,
      placeDetails: null,
      errors: [`Place could not be confirmed (confidence: ${response.confidence})`],
    };
    log.warn({ event: "state_update", ...truncateStrings(stateUpdate) });
    log.info({ event: "node_end", duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` });
    return stateUpdate;
  }

  const stateUpdate = {
    confidence: response.confidence,
    placeDetails: response.placeDetails,
  };
  log.info({ event: "state_update", ...truncateStrings(stateUpdate as Record<string, unknown>) });
  log.info({ event: "node_end", duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` });

  return stateUpdate;
};
```

- [ ] **Step 2: Update `src/agents/research-agent.ts`**

Add import at top:

```ts
import { createNodeLogger, truncateStrings } from "../logger";
```

Replace the `researchNode` function (lines 26-54) with:

```ts
export const researchNode = async (state: GraphState, config: NodeConfig) => {
  const log = createNodeLogger("LangGraph::Node", "research", config);
  log.info({ event: "node_start" });
  const startTime = Date.now();

  const placeDetails = state.placeDetails;
  const configurable = config.configurable ?? {};
  const placeName = placeDetails?.placeName ?? configurable.placeName;
  const destinationName = placeDetails?.destinationName ?? configurable.destinationName;
  const country = placeDetails?.country ?? configurable.country;
  const address = placeDetails?.address ?? configurable.address ?? "";

  let userMessage = `Research this place: ${placeName} in ${destinationName}, ${country}`;
  if (address) {
    userMessage += `\nAddress: ${address}`;
  }

  const result = await researchAgent.invoke({
    messages: [{
      role: "user",
      content: userMessage,
    }],
  });

  const stateUpdate = {
    researchNotes: result.structuredResponse.researchNotes,
    researchSources: result.structuredResponse.researchSources,
  };
  log.info({ event: "state_update", ...truncateStrings(stateUpdate) });
  log.info({ event: "node_end", duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` });

  return stateUpdate;
};
```

- [ ] **Step 3: Update `src/agents/editorial-agent.ts`**

Add import at top:

```ts
import { createNodeLogger, truncateStrings } from "../logger";
```

Replace the `editorialNode` function (lines 64-92) with:

```ts
export const editorialNode = async (state: GraphState, config: NodeConfig) => {
  const log = createNodeLogger("LangGraph::Node", "editorial", config);
  log.info({ event: "node_start" });
  const startTime = Date.now();

  const visualSummary = state.visualSummary || "";
  const notes = (config.configurable?.notes as string) || "";

  let userMessage = `Write editorial content using these research notes:\n\n${state.researchNotes}`;

  if (visualSummary) {
    userMessage += `\n\n## Visual observations from submitted photos\n\n${visualSummary}`;
  }

  if (notes) {
    userMessage += `\n\n## User notes (subjective, unverified)\n\n${notes}`;
  }

  const result = await editorialAgent.invoke({
    messages: [{
      role: "user",
      content: userMessage,
    }],
  });

  const stateUpdate = {
    editorialContent: result.structuredResponse,
  };
  log.info({ event: "state_update", ...truncateStrings(stateUpdate as Record<string, unknown>) });
  log.info({ event: "node_end", duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` });

  return stateUpdate;
};
```

- [ ] **Step 4: Verify all three compile**

Run: `npx tsc --noEmit`

Expected: No errors. All `console.log` calls removed from these three files.

---

### Task 9: CLI Logging

**Files:**
- Modify: `src/cli.ts:1-71`

**Context:** Replace all `console.log` and `console.error` calls with Pino using `App::CLI` layer. The CLI doesn't have a `NodeConfig`, so import the singleton logger directly and create a child with `{ layer: "App::CLI", agent: "" }`.

- [ ] **Step 1: Update `src/cli.ts`**

Replace the file contents with:

```ts
#!/usr/bin/env node
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import { generate } from "./index";
import { PASSING_CONFIDENCE, type ConfidenceLevel } from "./context";
import { logger } from "./logger";

const cliLog = logger.child({ layer: "App::CLI", agent: "" });

const program = new Command();

program
  .name("scribekit")
  .description("AI-powered multi-agent content generation toolkit")
  .version("0.1.0");

program
  .command("generate")
  .description("Generate editorial content for a place")
  .requiredOption("-i, --input <path>", "Path to input JSON file")
  .option("-o, --output <path>", "Path to output JSON file", "output.json")
  .action(async (opts) => {
    const inputPath = resolve(opts.input);
    const outputPath = resolve(opts.output);

    const input = JSON.parse(readFileSync(inputPath, "utf-8"));

    if (!input.placeName || !input.destinationName) {
      cliLog.error({ event: "failed", errors: ["Input JSON must include placeName and destinationName."] });
      process.exit(1);
    }

    if (input.imageUrls && input.imageUrls.length > 5) {
      cliLog.error({ event: "failed", errors: ["Maximum 5 image URLs allowed."] });
      process.exit(1);
    }

    cliLog.info({
      event: "input_loaded",
      placeName: input.placeName,
      destinationName: input.destinationName,
      imageCount: input.imageUrls?.length ?? 0,
    });

    const result = await generate(input);

    if (result.errors.length > 0) {
      cliLog.warn({ event: "failed", errors: result.errors });
    }

    if (!PASSING_CONFIDENCE.has(result.confidence as ConfidenceLevel)) {
      cliLog.error({
        event: "failed",
        errors: [`Place could not be confirmed (confidence: ${result.confidence}). Pipeline stopped.`],
      });
    }

    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    cliLog.info({ event: "output_written", path: outputPath });
  });

program.parse();
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/cli.ts`

Expected: No errors. Zero remaining `console.log` or `console.error` calls.

---

### Task 10: Final Verification

**Files:** None (read-only verification)

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`

Expected: No type errors across the entire project.

- [ ] **Step 2: Lint check**

Run: `npm run lint`

Expected: No lint errors. If there are new warnings about unused imports (e.g., old `console` references), fix them.

- [ ] **Step 3: Verify no remaining `console.log` in source**

Run: `grep -rn "console\.\(log\|error\|warn\)" src/ --include="*.ts" | grep -v ".test.ts" | grep -v "node_modules"`

Expected: Zero matches. All console calls replaced with Pino.

- [ ] **Step 4: Build check**

Run: `npm run build`

Expected: Build succeeds with no errors. Output in `dist/`.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev -- generate --input examples/cli-input.json --output result.json`

Expected:
- Terminal shows colorized pino-pretty output with the full pipeline trace (layer │ agent │ event format)
- `logs/scribekit.log` is created with structured JSON lines
- `result.json` is written with the generated content
- Red `ERROR` and yellow `WARN` lines are visually distinct in terminal

Verify the trace includes events from all layers:
- `App::CLI` — input_loaded, output_written
- `App::Pipeline` — pipeline_start, pipeline_end
- `App::Routing` — routing_decision (at least one)
- `LangGraph::Node` — node_start, node_end, state_update (for each agent)
- `LangGraph::LLM` — llm_start, llm_end (for each agent)
- `LangGraph::Tool` — tool_start, tool_end (for identification and research agents)
- `App::Node` — image_fetch, image_filter (if input includes imageUrls)
