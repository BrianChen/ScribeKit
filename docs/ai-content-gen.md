---
summary: ""
read_when:
  - Using editorial content generation
title: "AI Editorial content generation workflow"
---

## Prerequisites
- `@langchain/langgraph`, `@langchain/anthropic`, `langchain`, `cheerio` installed
- `ANTHROPIC_API_KEY` in `.env`

## Overview

ScribeKit generates structured editorial content using a multi-agent orchestration layer built with LangChain and LangGraph in TypeScript. It takes a JSON input describing a place, runs a research agent to gather facts from the web, then an editorial agent to produce polished content conforming to a strict output schema.

## File structure
```
src/
  index.ts                # Library entry — generate() function
  cli.ts                  # CLI entry point
  graph.ts                # LangGraph StateGraph — wires nodes + edges
  context.ts              # Zod schema for immutable context
  agents/
    research-agent.ts     # Research agent + researchNode wrapper
    editorial-agent.ts    # Editorial agent + editorialNode wrapper
  tools/
    fetch-url.ts          # fetch_url tool — secure fetch + cheerio HTML stripping
  helpers/
    url-validator.ts      # URL validation — SSRF protection, private IP blocking
  prompts/
    research.ts           # Research agent system prompt
    editorial.ts          # Editorial agent system prompt
```

## Usage

### CLI
```bash
npx scribekit generate --input input.json --output result.json
```

### Library
```ts
import { generate } from "scribekit";

const result = await generate({
  placeName: "Eiffel Tower",
  destinationName: "Paris",
  country: "France",
  address: "Champ de Mars, 5 Av. Anatole France, 75007 Paris",
  latitude: 48.8584,
  longitude: 2.2945,
  reservable: true,
  openingHours: {
    weekdayDescriptions: ["Monday: 9:30 AM - 12:45 AM"]
  }
});
```

Input must match the Context schema:
```json
{
  "placeName": "Eiffel Tower",
  "destinationName": "Paris",
  "country": "France",
  "address": "Champ de Mars, 5 Av. Anatole France, 75007 Paris",
  "latitude": 48.8584,
  "longitude": 2.2945,
  "reservable": true,
  "openingHours": {
    "weekdayDescriptions": ["Monday: 9:30 AM - 12:45 AM"]
  }
}
```

## Agents

### 1. Research Agent (`agents/research-agent.ts`)
Gathers information on the place using trained data and web fetching.
- **Model:** `claude-haiku-4-5-20251001` (maxTokens: 1024)
- **Tools:** `[fetch_url]`
- **Middleware:** `toolCallLimitMiddleware({ runLimit: 3 })` — hard cap on fetch calls
- **Output:** writes `researchNotes` and `researchSources` to state via `result.structuredResponse`
- **Prompt:** `prompts/research.ts` — covers practical details, history, visitor experience, seasonal considerations, local tips, vibe/mood, uniqueness

### 2. Editorial Agent (`agents/editorial-agent.ts`)
Receives research notes + context, writes all editorial content fields.
- **Model:** `claude-sonnet-4-6` (maxTokens: 4096)
- **Tools:** none (pure generation)
- **Output:** writes `editorialContent` to state via `result.structuredResponse`
- **Output schema:** `EditorialOutput` Zod schema with `z.enum()` enforcement for enum fields (indoorOutdoor, visitDuration, moods, categories, confidence levels)
- **Prompt:** `prompts/editorial.ts` — writing style/tone, field-level guidance, confidence levels

## Tools (`tools/`)
- `fetch_url` — secure URL fetcher for research agent. Defined with `tool()` from `langchain` with a Zod schema. Tools are bound to agents via `createAgent({ tools: [...] })`, not added as graph nodes.

### fetch_url security layers
1. **URL validation** (`helpers/url-validator.ts`):
   - HTTPS only — blocks `file://`, `http://`, `ftp://`
   - Blocked hostnames — `localhost`, `0.0.0.0`, `[::1]`, `[::]`
   - Blocked TLDs — `.localhost`, `.local`
   - Userinfo blocking — rejects `https://user@host` URLs
   - DNS resolution + private IP check — blocks `127.x`, `10.x`, `172.16-31.x`, `192.168.x`, `169.254.x` (cloud metadata), carrier-grade NAT, IPv4-mapped IPv6 (`::ffff:127.0.0.1`), IPv6 unique local (`fc00::/7`), link-local (`fe80::/10`)
   - Try/catch fail-closed — malformed URLs or DNS failures reject by default
2. **Fetch hardening** (`tools/fetch-url.ts`):
   - `method: "GET"` — explicit GET only
   - `redirect: "error"` — blocks redirect-based SSRF bypass
   - `credentials: "omit"` — never sends cookies/auth
   - `AbortSignal.timeout(10_000)` — 10s timeout
   - `User-Agent: "ScribeKit/1.0"`
   - Content-type check — rejects non-`text/` responses
3. **Response processing**:
   - HTML → text via cheerio: strips `script, style, nav, footer, header, noscript, aside, form, iframe, svg` and HTML comments
   - Whitespace collapse — `replace(/\s+/g, " ")`
   - 50k char cap — truncates to protect LLM context window

## Context vs State

**Context** (immutable, passed via `configurable`):
```ts
export const Context = z.object({
  placeName: z.string(),
  destinationName: z.string(),
  country: z.string(),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  reservable: z.boolean().nullable(),
  openingHours: z.object({
    weekdayDescriptions: z.array(z.string()),
  }).nullable(),
});
```

**State** (mutable, evolves through graph):
```ts
const State = new StateSchema({
  researchNotes: z.string().default(""),
  researchSources: z.array(z.string()).default([]),
  editorialContent: z.record(z.any()).nullable().default(null),
  errors: z.array(z.string()).default([]),
});
```

Context is read-only — agents can see it but can't modify it. State is the working memory that agents write to.

### Note on lat/lng
The input may optionally resolve coordinates from a parent entity (e.g., destination-level fallback when place coords are null). The context schema only has `latitude`/`longitude` — always the resolved value.

## Graph flow
```
                    ┌─────────────┐
                    │  fetch_url  │
                    └──────┬──────┘         
                           │ (tool call)
                           │
START ──> research-agent ──┼──> editorial-agent ──> END
              │            |          │
              │   (may call multiple  │
              │    times or not at    │
              │    all)               │
              │                       │
         reads context           reads context
         writes: researchNotes   reads: researchNotes
                                 writes: editorialContent
```
Linear flow. No review loop or conditional routing yet. Edges are fixed via `addEdge()`.

## Key design decisions
- **Agents wrapped in node functions** — `createAgent` returns a `ReactAgent` which can't be passed directly to `StateGraph.addNode()`. The node function adapts between graph state and the agent's message-based interface.
- **Context is a plain `z.object()`** — `createAgent`'s `contextSchema` expects `AnyAnnotationRoot | InteropZodObject`, not `StateSchema`.
- **Tools talk to the LLM, not to state** — tool results go back to the agent's message history. State only changes when a node function returns values.
- **MemorySaver checkpointer** — enables durable execution / resume. Thread ID is `placeName--destinationName`.
- **JSON output only** — no database coupling. Consumers import the JSON into their own data store.
