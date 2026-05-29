# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev -- generate --input workspace/cli-input.json --output workspace/result.json  # run CLI in dev mode
npm run build          # build with tsup (ESM, outputs to dist/)
npm test               # run tests (node --test with --experimental-strip-types)
npm run lint           # eslint src/
```

To run a single test file:
```bash
node --test --experimental-strip-types src/tools/fetch-url.test.ts
```

## Environment

Requires `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`, and optional `LOG_LEVEL` (default: `info`) in `.env` (see `.env.example`). Loaded by `dotenv`.

## Architecture

ScribeKit is a multi-agent content generation pipeline for travel places. Input is a place name, city, country, optional address hint, optional freeform notes, and up to 5 image URLs. The pipeline verifies the place via Google Places, researches it, and produces structured editorial content.

### Pipeline

```
START → (has images?) → image-analysis-agent → identification-agent → (confidence >= MEDIUM?) → research-agent → editorial-agent → END
                      → identification-agent ─────────────────────────────────────────────────────────────────────┘
                                                                    → END (error: LOW/NONE confidence)
```

Two conditional edges:
1. **After START** — routes to `image-analysis-agent` if `imageUrls` is present and non-empty, otherwise skips to `identification-agent`.
2. **After identification-agent** — routes to `research-agent` if confidence is VERY_HIGH, HIGH, or MEDIUM (`PASSING_CONFIDENCE` in `context.ts`). Routes to END if LOW or NONE.

### Context vs State

- **Context** (`context.ts`) — immutable input (placeName, destinationName, country, address hint, imageUrls, notes) passed via LangGraph's `configurable`. Defined as a plain Zod object (not `StateSchema`) because `createAgent`'s `contextSchema` requires `AnyAnnotationRoot | InteropZodObject`.
- **State** (`graph.ts`) — mutable working memory that agents write to through their node wrapper functions. Includes image analysis outputs (visualSummary, identificationCues, filteredImageUrls), identification outputs (confidence, placeDetails), research outputs (researchNotes, researchSources), editorial outputs (editorialContent), and errors.

### Agent pattern

Agents are created with `createAgent()` from `langchain` and wrapped in node functions that adapt between LangGraph's state interface and the agent's message-based interface. Tools talk to the LLM via message history — state only changes when the node function returns values.

- **Image analysis agent** — uses `claude-haiku-4-5-20251001` (vision), no tools. Receives up to 5 images as base64, filters for place-relevant images, extracts identification cues (signage, venue type, cuisine) and visual summaries (atmosphere, decor, vibe). Images fetched/validated via `helpers/image-fetcher.ts` using the existing SSRF protection layer.
- **Identification agent** — uses `claude-haiku-4-5-20251001` with `google_places` tool (capped at 1 tool call). Takes submitted input + identification cues, confirms the place exists via Google Places, returns verified place details (name, address, coords, phone, website, priceLevel, openingHours, accessibilityOptions) with a confidence level.
- **Research agent** — uses `claude-haiku-4-5-20251001` with `fetch_url` tool (capped at 3 tool calls). Uses verified `placeDetails` from state. Outputs `researchNotes` and `researchSources`.
- **Editorial agent** — uses `claude-sonnet-4-6`, no tools, pure generation. Receives research notes + visual summary + user notes. Outputs structured `EditorialOutput` (tagline, description, moods, categories, confidence levels, etc.).

### Security

The `fetch_url` tool and image fetcher share layered SSRF protection (`helpers/url-validator.ts`):
- HTTPS-only, no credentials in URLs, no redirects (`redirect: "error"`)
- DNS resolution with private/internal IP blocking (IPv4, IPv6, IPv4-mapped IPv6)
- Cloud metadata IP blocking (169.254.169.254, etc.)
- Response capped at 50k chars after HTML stripping via cheerio

### Logging

Structured logging via Pino with dual transports: `pino-pretty` to terminal (colorized), JSON to `workspace/scribekit.log` (gitignored). Two parallel paths:

- **Callback handler** (`src/logging/callback-handler.ts`) — extends `BaseTracer`, auto-captures LLM and tool lifecycle events (`LangGraph::LLM`, `LangGraph::Tool`). Created in `generate()`, passed via `graph.invoke({ callbacks: [...] })`.
- **Node-level logging** (`src/logger.ts`) — manual Pino child loggers in node wrappers, routing functions, and `generate()`. Covers `App::Pipeline`, `App::Routing`, `App::Node`, `App::CLI`, and `LangGraph::Node` layers.

`createNodeLogger(layer, agent)` creates a child logger with only `layer` and `agent` bound. `createPipelineLogger()` and `createCallbackLogger()` do the same for their respective layers. Place context (`placeName`, `destinationName`, `country`, `imageUrls`, `notes`) is logged once as fields on `pipeline_start` — not bound to child loggers.

### Key details

- Thread ID for checkpointer is `{placeName}--{destinationName}`
- Output is JSON-only, no database coupling
- Prompts live in `src/prompts/` and contain detailed field-level writing guidance
- Address, coordinates, phone, website, priceLevel, openingHours, and accessibilityOptions come from Google Places (not user input)
- Log output to terminal via `pino-pretty`, to file at `workspace/scribekit.log`; level controlled by `LOG_LEVEL` env var
