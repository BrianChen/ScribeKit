# Error States Design

**Date:** 2026-05-29  
**Status:** Approved

## Overview

Defines a clear error taxonomy for the ScribeKit pipeline and introduces a typed public error surface (`ScribeKitError`) and an `ok` field on `GenerateResult` that mirrors the `fetch` API's `response.ok` pattern.

---

## Error Taxonomy

| Scenario | Behaviour |
|----------|-----------|
| Image fetch partial failure | Appended to `errors[]`, pipeline continues |
| `fetch_url` tool failure (research) | Error string returned to LLM — recoverable, LLM can try another URL or use training data |
| Google Places API down | Error string returned to LLM — likely produces LOW/NONE confidence |
| LOW/NONE confidence (place not confirmed) | Returns `GenerateResult` with `ok: false` |
| Agent `invoke()` throws (rate limit, auth, network) | Caught in `generate()`, rethrown as `ScribeKitError` |
| LangGraph internal error (graph misconfiguration, recursion limit) | Caught in `generate()`, rethrown as `ScribeKitError` with generic internal error message |

### Why `fetch_url` failures return strings to the LLM

The research agent has a cap of 3 tool calls. A single URL failing is recoverable — the LLM can try a different URL or draw from training data. Throwing from the tool would propagate a fatal error for what is a non-fatal condition. If all 3 calls fail, the research notes will be thinner but the pipeline continues.

### Why LOW/NONE confidence returns `GenerateResult` (not throws)

The pipeline ran correctly — it just found no matching place. This mirrors how `fetch()` handles a 404: the promise resolves, `response.ok` is false, and the body is structurally present but not useful. Throwing would conflate "infrastructure down" with "place not found", which are fundamentally different outcomes.

---

## `result.ok`

Added to `GenerateResult`. Mirrors `response.ok` from the fetch API.

```ts
interface GenerateResult {
  ok: boolean;   // false when confidence is LOW | NONE
  // ... all existing fields unchanged
}
```

`ok: false` means the place was not confirmed by Google Places. `editorialContent` and `researchNotes` will be empty. `confidence` tells the caller how close identification got. `errors[]` carries the human-readable reason.

Caller pattern:
```ts
const result = await generate(input);  // throws ScribeKitError on infrastructure failure
if (!result.ok) {
  // place not found — check result.confidence and result.errors for detail
  return;
}
// safe to consume result.editorialContent, result.researchNotes, etc.
```

### What GenerateResult looks like when ok: false

For an unrecognised place with no images:
```json
{
  "ok": false,
  "confidence": "NONE",
  "errors": ["Place could not be confirmed (confidence: NONE)"],
  "placeName": "The Blarf Bar",
  "destinationName": "Reykjavik",
  "country": "Iceland",
  "address": "",
  "latitude": 0,
  "longitude": 0,
  "phone": null,
  "website": null,
  "priceLevel": null,
  "openingHours": null,
  "accessibilityOptions": null,
  "researchNotes": "",
  "researchSources": [],
  "editorialContent": {},
  "filteredImageUrls": [],
  "generatedAt": "2026-05-29T10:00:00.000Z"
}
```

`placeName`, `destinationName`, `country` fall back to raw user input (not verified). `latitude: 0, longitude: 0` is a real coordinate (Gulf of Guinea) — callers must check `ok` before using location data.

---

## `ScribeKitError`

A thin wrapper that forms the stable public error surface of the library. Callers should never need to catch raw Anthropic SDK or LangGraph errors directly.

```ts
// src/errors.ts
export class ScribeKitError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ScribeKitError";
  }
}
```

### Why a wrapper at all

ScribeKit is a library. Letting raw Anthropic SDK errors (`RateLimitError`, etc.) propagate would leak the implementation detail that ScribeKit uses Anthropic. If the provider changes, callers' catch blocks break. `ScribeKitError` is the stable catch surface — provider details remain accessible via `cause` for callers who need them.

### Why thin (no error codes or field copying)

Adding error codes (`RATE_LIMIT`, `AUTH_FAILURE`, etc.) requires maintaining a classification layer that drifts as providers update their error taxonomies. Copying fields from the original error is fragile across providers (Anthropic uses `type`, OpenAI adds `code` and `param`). Callers who need provider-specific detail reach into `cause` directly.

### `cause` shapes

**Provider error** (e.g. Anthropic rate limit, auth failure, network error):
```
cause.status     — HTTP status code (429, 401, 500, etc.)
cause.type       — Anthropic error type string ("rate_limit_error", "authentication_error", etc.)
cause.message    — human-readable error message
cause.error      — raw JSON body ({ type, message })
cause.requestID  — Anthropic request ID, useful for support tickets
cause.headers    — HTTP response headers
cause.name       — SDK class name ("RateLimitError", "BadRequestError", etc.)
```

Fields vary by provider when additional LLM providers are added. OpenAI exposes the same core fields (`status`, `type`, `requestID`, `headers`) plus `code` and `param`.

**LangGraph internal error** (graph misconfiguration, recursion limit — indicates a ScribeKit bug):
```
cause.name          — error class ("GraphRecursionError", "InvalidUpdateError", etc.)
cause.message       — error message
cause.lc_error_code — LangGraph troubleshooting code
```

---

## Catch Boundary

Single try/catch in `generate()` wrapping `graph.invoke()`. No changes to node wrappers — errors from `agent.invoke()` propagate naturally through LangGraph.

```ts
try {
  const result = await graph.invoke(...);
} catch (e) {
  if (e instanceof BaseLangGraphError) {
    throw new ScribeKitError("ScribeKit encountered an internal error.", { cause: e });
  }
  throw new ScribeKitError(
    e instanceof Error ? e.message : "Pipeline failed",
    { cause: e }
  );
}
```

Two cases:
- **`BaseLangGraphError`** — graph misconfiguration or internal LangGraph failure. Generic message because these indicate ScribeKit bugs, not caller-facing conditions. Full detail in `cause`.
- **Everything else** — provider errors (`RateLimitError`, `AuthenticationError`, `APIConnectionError`) and LangChain core errors (`ContextOverflowError`, `ModelAbortError`). Original error message surfaced since it's meaningful to callers.

### Note on retries

LangGraph has built-in retry logic that retries on 429 and 5xx by default. All nodes currently have `retryPolicy: { maxAttempts: 1 }` disabling this. The Anthropic SDK has `maxRetries: 2` at the request level. Re-enabling LangGraph node-level retries is a separate concern — doing both creates double-retry complexity and is out of scope for this design.

---

## File Changes

| File | Change |
|------|--------|
| `src/errors.ts` | New — `ScribeKitError` class |
| `src/index.ts` | Add `ok` to `GenerateResult`, try/catch in `generate()`, export `ScribeKitError` |
| `src/agents/*.ts` | None |
| `src/graph.ts` | None |
