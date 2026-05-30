# Error States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `ScribeKitError` as a typed public error surface and add `result.ok` to `GenerateResult` to signal when the pipeline completed vs when a place was not confirmed.

**Architecture:** A new `src/errors.ts` exports `ScribeKitError` — a thin wrapper around `Error` that forms the stable catch surface for library consumers. `generate()` in `src/index.ts` gains a try/catch around `graph.invoke()` that wraps all thrown errors, and `GenerateResult` gains an `ok: boolean` field that mirrors `response.ok` from the fetch API.

**Tech Stack:** TypeScript, `node:test`, `@langchain/langgraph` (`BaseLangGraphError`)

---

### Task 1: Create `ScribeKitError`

**Files:**
- Create: `src/errors.ts`
- Create: `src/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/errors.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ScribeKitError } from "./errors.ts";

describe("ScribeKitError", () => {
  it("is an instance of Error", () => {
    const e = new ScribeKitError("test");
    assert.ok(e instanceof Error);
  });

  it("is an instance of ScribeKitError", () => {
    const e = new ScribeKitError("test");
    assert.ok(e instanceof ScribeKitError);
  });

  it("sets name to ScribeKitError", () => {
    const e = new ScribeKitError("test");
    assert.equal(e.name, "ScribeKitError");
  });

  it("sets message", () => {
    const e = new ScribeKitError("something went wrong");
    assert.equal(e.message, "something went wrong");
  });

  it("preserves cause", () => {
    const original = new Error("original");
    const e = new ScribeKitError("wrapped", { cause: original });
    assert.equal(e.cause, original);
  });

  it("works without cause", () => {
    const e = new ScribeKitError("no cause");
    assert.equal(e.cause, undefined);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test --experimental-strip-types src/errors.test.ts
```

Expected: fail with `Cannot find module './errors.ts'`

- [ ] **Step 3: Create `src/errors.ts`**

```ts
/**
 * Thrown when the ScribeKit pipeline fails due to an infrastructure error
 * (e.g. rate limit, authentication failure, network error).
 *
 * `cause` holds the original provider error. Two possible shapes:
 *
 * Provider error (e.g. Anthropic rate limit, auth failure, network error):
 *   cause.status     — HTTP status code (429, 401, 500, etc.)
 *   cause.type       — error type string ("rate_limit_error", "authentication_error", etc.)
 *   cause.message    — human-readable error message
 *   cause.error      — raw JSON body ({ type, message })
 *   cause.requestID  — request ID for support tickets
 *   cause.headers    — HTTP response headers
 *   cause.name       — SDK class name ("RateLimitError", "BadRequestError", etc.)
 *
 * Fields vary by provider when additional LLM providers are added.
 * OpenAI exposes the same core fields plus `code` and `param`.
 *
 * LangGraph internal error (graph misconfiguration, recursion limit — indicates a ScribeKit bug):
 *   cause.name          — error class ("GraphRecursionError", "InvalidUpdateError", etc.)
 *   cause.message       — error message
 *   cause.lc_error_code — LangGraph troubleshooting code
 */
export class ScribeKitError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ScribeKitError";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test --experimental-strip-types src/errors.test.ts
```

Expected: all 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts src/errors.test.ts
git commit -m "feat: add ScribeKitError as typed public error surface"
```

---

### Task 2: Add `ok` to `GenerateResult` and catch boundary in `generate()`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add `ok` to the `GenerateResult` interface**

In `src/index.ts`, update the interface (currently at line 17):

```ts
export interface GenerateResult {
  ok: boolean;
  placeName: string;
  destinationName: string;
  country: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  website: string | null;
  priceLevel: string | null;
  openingHours: { weekdayDescriptions: string[] } | null;
  accessibilityOptions: Record<string, boolean> | null;
  confidence: ConfidenceLevel;
  researchNotes: string;
  researchSources: string[];
  editorialContent: Record<string, unknown>;
  filteredImageUrls: string[];
  errors: string[];
  generatedAt: string;
}
```

- [ ] **Step 2: Add imports for `ScribeKitError`, `BaseLangGraphError`, and `GraphState`**

At the top of `src/index.ts`, add to the existing imports:

```ts
import { BaseLangGraphError } from "@langchain/langgraph";
import { ScribeKitError } from "./errors";
import { type GraphState } from "./state";
```

- [ ] **Step 3: Wrap `graph.invoke()` in try/catch and add `ok` to the output**

Replace the existing `graph.invoke()` call and output construction. The full updated `generate()` function body:

```ts
export async function generate(input: GenerateInput): Promise<GenerateResult> {
  const parsed = Context.parse(input);
  const pipelineLog = createPipelineLogger();
  const callbackHandler = new PinoCallbackHandler(createCallbackLogger());

  pipelineLog.info({
    event: "pipeline_start",
    placeName: parsed.placeName,
    destinationName: parsed.destinationName,
    country: parsed.country,
    imageCount: parsed.imageUrls?.length ?? 0,
    ...(parsed.imageUrls?.length && { imageUrls: parsed.imageUrls }),
    ...(parsed.notes && { notes: parsed.notes }),
  });

  const startTime = Date.now();

  let result!: GraphState;
  try {
    result = await graph.invoke(
      {},
      {
        callbacks: [callbackHandler],
        configurable: { thread_id: `${parsed.placeName}--${parsed.destinationName}`, ...parsed },
      },
    );
  } catch (e) {
    if (e instanceof BaseLangGraphError) {
      throw new ScribeKitError("ScribeKit encountered an internal error.", { cause: e });
    }
    throw new ScribeKitError(
      e instanceof Error ? e.message : "Pipeline failed",
      { cause: e },
    );
  }

  const placeDetails = result.placeDetails;
  const output: GenerateResult = {
    ok: PASSING_CONFIDENCE.has(result.confidence as ConfidenceLevel),
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

- [ ] **Step 4: Export `ScribeKitError` from the public API**

At the top of `src/index.ts`, add to the existing export lines:

```ts
export { ScribeKitError } from "./errors";
```

- [ ] **Step 5: Build to verify no type errors**

```bash
npm run build
```

Expected: exits 0, `dist/` updated with no TypeScript errors

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: all existing tests pass

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: add result.ok and ScribeKitError catch boundary to generate()"
```
