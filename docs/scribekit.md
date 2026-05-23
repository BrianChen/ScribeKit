---
summary: "Multi-agent pipeline (LangGraph + LangChain) that takes place submissions (name, city, country, optional images/notes), verifies via Google Places, research place and generates structured editorial content through four agents: image analysis → identification → research → editorial."
read_when:
  - Using editorial content generation
title: "AI Editorial content generation workflow"
---

## Prerequisites
- `@langchain/langgraph`, `@langchain/anthropic`, `langchain`, `cheerio` installed
- `ANTHROPIC_API_KEY` and `GOOGLE_PLACES_API_KEY` in `.env`

## Overview

ScribeKit generates structured editorial content for travel places using a multi-agent orchestration layer built with LangChain and LangGraph in TypeScript. Input is a place (name, city, country) with optional address hints, freeform notes, and up to 5 image URLs. The pipeline filters images, verifies the place via Google Places, researches it, and produces polished editorial content.

## File structure
```
src/
  index.ts                # Library entry — generate() function
  cli.ts                  # CLI entry point
  graph.ts                # LangGraph StateGraph — wires nodes + conditional edges
  context.ts              # Zod schema for immutable context + confidence levels
  state.ts                # LangGraph Annotation state + PlaceDetails interface
  agents/
    image-analysis-agent.ts   # Image analysis agent + imageAnalysisNode wrapper
    identification-agent.ts   # Place identification agent + identificationNode wrapper
    research-agent.ts         # Research agent + researchNode wrapper
    editorial-agent.ts        # Editorial agent + editorialNode wrapper
  tools/
    fetch-url.ts          # fetch_url tool — secure fetch + cheerio HTML stripping
    google-places.ts      # google_places tool — Google Places API text search
  helpers/
    image-fetcher.ts      # Fetch + validate images, convert to base64
    url-validator.ts       # URL validation — SSRF protection, private IP blocking
  prompts/
    image-analysis.ts     # Image analysis agent system prompt
    identification.ts     # Identification agent system prompt
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
  placeName: "The Edge",
  destinationName: "Bali",
  country: "Indonesia",
  address: "Jl. Karang Mas Sejahtera",       // optional hint, overridden by Google Places
  imageUrls: ["https://example.com/pic.jpg"], // optional, up to 5
  notes: "Amazing sunset views from the cliff" // optional freeform
});
```

Input schema:
```ts
interface GenerateInput {
  placeName: string;
  destinationName: string;
  country: string;
  address?: string | null;
  imageUrls?: string[];
  notes?: string;
}
```

## Pipeline

```
START → (has images?) → image-analysis-agent → identification-agent → (confidence >= MEDIUM?) → research-agent → editorial-agent → END
                      → identification-agent ─────────────────────────────────────────────────────────────────────┘
                                                                    → END (error: LOW/NONE confidence)
```

Two conditional edges:
1. **After START** — routes to `image-analysis-agent` if `imageUrls` is present and non-empty, otherwise skips to `identification-agent`.
2. **After identification-agent** — routes to `research-agent` if confidence is VERY_HIGH, HIGH, or MEDIUM (`PASSING_CONFIDENCE` in `context.ts`). Routes to END if LOW or NONE, with an error message.

## Agents

### 1. Image Analysis Agent (`agents/image-analysis-agent.ts`)
Analyzes submitted photos to extract place identification cues and visual descriptions.
- **Model:** `claude-haiku-4-5-20251001` (vision)
- **Tools:** none
- **Input:** up to 5 image URLs, fetched and converted to base64 via `helpers/image-fetcher.ts`
- **Output:** writes `visualSummary`, `identificationCues`, and `filteredImageUrls` to state
- **Behavior:** for each image, decides keep/discard (is it informative about the place?), extracts identification cues (signage text, venue type, cuisine, architectural style), and writes a visual summary (atmosphere, decor, vibe). Discarded images contribute nothing downstream.

### 2. Identification Agent (`agents/identification-agent.ts`)
Confirms the place exists and retrieves verified details from Google Places.
- **Model:** `claude-haiku-4-5-20251001`
- **Tools:** `[google_places]`
- **Middleware:** `toolCallLimitMiddleware({ runLimit: 1 })`
- **Input:** place name, destination, country, address hint + identification cues from image analysis (if available)
- **Output:** writes `confidence` and `placeDetails` to state
- **PlaceDetails includes:** verified name, destination, country, address, coordinates, phone, website, priceLevel, openingHours, accessibilityOptions — all from Google Places
- **Confidence levels:** VERY_HIGH (exact match) → HIGH (strong match) → MEDIUM (likely correct) → LOW (weak match) → NONE (nothing found)

### 3. Research Agent (`agents/research-agent.ts`)
Gathers information on the verified place using trained data and web fetching.
- **Model:** `claude-haiku-4-5-20251001` (maxTokens: 2048)
- **Tools:** `[fetch_url]`
- **Middleware:** `toolCallLimitMiddleware({ runLimit: 3 })` — hard cap on fetch calls
- **Input:** verified `placeDetails` from state (does not receive identification cues or user notes)
- **Output:** writes `researchNotes` and `researchSources` to state
- **Prompt:** covers practical details, history, visitor experience, seasonal considerations, local tips, vibe/mood, uniqueness

### 4. Editorial Agent (`agents/editorial-agent.ts`)
Produces polished editorial content from research notes and visual context.
- **Model:** `claude-sonnet-4-6` (maxTokens: 4096)
- **Tools:** none (pure generation)
- **Input:** `researchNotes` + `visualSummary` from state + user `notes` from configurable
- **Output:** writes `editorialContent` to state
- **Output schema:** `EditorialOutput` Zod schema with `z.enum()` enforcement for enum fields (indoorOutdoor, visitDuration, moods, categories, confidence levels)
- **Prompt:** writing style/tone, field-level guidance, confidence levels. Visual summary treated as snapshots (not comprehensive), user notes treated as subjective (not verified facts).

## Tools

### fetch_url (`tools/fetch-url.ts`)
Secure URL fetcher for the research agent. Defined with `tool()` from `langchain` with a Zod schema. Tools are bound to agents via `createAgent({ tools: [...] })`, not added as graph nodes.

#### Security layers
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

### google_places (`tools/google-places.ts`)
Searches Google Places API (Text Search) using place name, city, country, and optional address hint. Returns top candidates with: name, address, coordinates, phone, website, priceLevel, opening hours, accessibilityOptions. Requires `GOOGLE_PLACES_API_KEY` in `.env`.

### Image fetcher (`helpers/image-fetcher.ts`)
Fetches image URLs and converts them to base64 for the vision API. Uses the same `url-validator.ts` SSRF protection layer as `fetch_url`.

## Context vs State

**Context** (immutable, passed via `configurable`):
```ts
export const Context = z.object({
  placeName: z.string(),
  destinationName: z.string(),
  country: z.string(),
  address: z.string().nullable(),
  imageUrls: z.array(z.string().url()).max(5).optional(),
  notes: z.string().optional(),
});
```

**State** (mutable, evolves through graph — defined with `Annotation` API):
```ts
const State = Annotation.Root({
  // image analysis outputs
  visualSummary, identificationCues, filteredImageUrls,
  // identification outputs
  confidence, placeDetails,
  // research outputs
  researchNotes, researchSources,
  // editorial outputs
  editorialContent,
  // accumulated errors
  errors,
});
```

Context is read-only — agents can see it but can't modify it. State is the working memory that agents write to. Address, coordinates, phone, website, priceLevel, openingHours, and accessibilityOptions come from Google Places via the identification agent — they are not part of the input.

## Output

```ts
interface GenerateResult {
  placeName: string;            // verified by identification
  destinationName: string;      // verified by identification
  country: string;              // verified by identification
  address: string;              // from Google Places
  latitude: number;             // from Google Places
  longitude: number;            // from Google Places
  phone: string | null;         // from Google Places
  website: string | null;       // from Google Places
  priceLevel: string | null;    // from Google Places (e.g. PRICE_LEVEL_MODERATE)
  openingHours: { weekdayDescriptions: string[] } | null;
  accessibilityOptions: Record<string, boolean> | null;
  confidence: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
  researchNotes: string;
  researchSources: string[];
  editorialContent: Record<string, any>;
  filteredImageUrls: string[];  // valuable images passed through
  errors: string[];
  generatedAt: string;
}
```

When the graph ends early due to low confidence:
- `editorialContent` and `researchNotes` are empty.
- `confidence` tells the caller why it stopped.
- `errors` contains a message explaining the place couldn't be confirmed.

## Key design decisions
- **Agents wrapped in node functions** — `createAgent` returns a `ReactAgent` which can't be passed directly to `StateGraph.addNode()`. The node function adapts between graph state and the agent's message-based interface.
- **Context is a plain `z.object()`** — `createAgent`'s `contextSchema` expects `AnyAnnotationRoot | InteropZodObject`, not `StateSchema`.
- **State uses `Annotation` API** — `StateSchema` is incompatible with Zod 3.x; `Annotation.Root()` works.
- **Tools talk to the LLM, not to state** — tool results go back to the agent's message history. State only changes when a node function returns values.
- **MemorySaver checkpointer** — enables durable execution / resume. Thread ID is `{placeName}--{destinationName}`.
- **JSON output only** — no database coupling. Consumers import the JSON into their own data store.

## Data flow

| Agent | Receives | Produces |
|-------|----------|----------|
| **Image analysis** | image URLs (base64) | identificationCues, visualSummary, filteredImageUrls |
| **Identification** | submitted input + identificationCues | confidence, placeDetails (name, address, coords, phone, website, priceLevel, openingHours, accessibilityOptions) |
| **Research** | verified placeDetails | researchNotes, researchSources |
| **Editorial** | researchNotes + visualSummary + user notes | editorialContent |

## Future considerations
### Needs product brainstorming
- **Define Input format and validation:** 
Define use cases and define structured input format.
1. User submits "The edge, NYC"
2. User submits "The edge, New York, US" - skips image analysis, run identification, run research, run editorial
3. User submits "The edge, New York, US", Images[] - run image analysis, run identification, run research, run editorial
4. User submits "The edge, New York, US", Images[], notes
5. User submits "The edge, New York, US", notes

No input validation on placeName or destination (ScribeKit can write to pending table for manual approval).
PlaceName, city, country is required
Images, notes, address are optional

- **Notes filtering:** 
Freeform notes may need a filtering/cleaning step before being passed to the editorial agent to strip out inaccuracies, irrelevant content, or poorly formatted text.
- Do not implement until input format/use case is well defined

### V2
- **Logging:** 
No structured logging exists in the pipeline. Each agent node and key operations (image fetching, Google Places calls, confidence gating, early termination) should emit logs with timing, input/output summaries, and error details.
- **Error states review:** 
The pipeline has several error paths that need review: image fetch failures (partial vs total), Google Places API errors, agent invocation failures, and early termination (LOW/NONE confidence). Should define a clear error taxonomy and decide on retry vs fail-fast semantics for each category.
- **Fallback for places not on Google Places:** 
New, informal, or unlisted places will be rejected under the current gate logic. A future iteration could have the research agent act as a secondary verification step — searching the web for evidence the place exists and upgrading the confidence if found.
- **Factual fields redistribution:** 
Several editorial output fields are factual rather than creative (neighbourhood, visitDuration, bookingRequired, bookInAdvanceWarning, dressCode, indoorOutdoor, weatherDependent, seasonalTips). These may be better owned by the research agent, which has direct access to factual sources.

### V3
- **Video input:** 
Would require audio transcription (Whisper, Deepgram) and key frame extraction. Deferred — start with images first.