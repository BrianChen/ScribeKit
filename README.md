<p align="center">
  <h1 align="center">ScribeKit</h1>
  <p align="center">
    Multi-agent content generation pipeline for travel places
    <br />
    Built with LangGraph + LangChain + Claude
  </p>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="#usage">Usage</a> &middot;
  <a href="#output">Output</a> &middot;
  <a href="#project-structure">Project Structure</a>
</p>

---

ScribeKit takes a place submission — name, city, country, optional photos and notes — and runs it through a four-agent pipeline that verifies the place via Google Places, researches it from the web, and produces structured editorial content ready for consumption.

## Quick Start

```bash
npm install
```

Create a `.env` file with your API keys:

```env
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_PLACES_API_KEY=...

# Optional — required only if passing private Cloudinary image URLs
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Run the full pipeline (clears logs, runs, prettifies):

```bash
npm run run:pipeline
```

Or run manually:

```bash
npm run dev -- generate --input workspace/cli-input.json --output workspace/result.json
```

## How It Works

```
START → (has images?) → Image Analysis → Identification → (confidence ≥ MEDIUM?) → Research → Editorial → END
                      → Identification ──────────────────────────────────────────────────────┘
                                                          → END (LOW/NONE confidence)
```

The pipeline has two conditional gates:

1. **Image gate** — if the submission includes image URLs, the image analysis agent runs first to filter photos and extract visual cues. Otherwise, it skips straight to identification.
2. **Confidence gate** — the identification agent verifies the place via Google Places and assigns a confidence level. Only VERY_HIGH, HIGH, or MEDIUM proceed to research and editorial. LOW or NONE terminates early with an error.

### Agents

| Agent | Model | Role |
|-------|-------|------|
| **Image Analysis** | `claude-haiku-4-5` (vision) | Filters submitted photos for relevance, extracts identification cues (signage, venue type, cuisine) and visual summaries (atmosphere, decor, vibe) |
| **Identification** | `claude-haiku-4-5` | Confirms the place exists via the `google_places` tool, returns verified details (address, coordinates, phone, website, hours, pricing) |
| **Research** | `claude-haiku-4-5` | Gathers factual information using the `fetch_url` tool — practical details, history, visitor experience, seasonal tips |
| **Editorial** | `claude-sonnet-4-6` | Writes structured editorial content from research notes, visual context, and user notes |

## Usage

### CLI

```bash
npm run dev -- generate --input workspace/cli-input.json --output workspace/result.json
```

### Library

```ts
import { generate } from "scribekit";

const result = await generate({
  placeName: "Ichiran Ramen",
  destinationName: "Tokyo",
  country: "Japan",
  address: "1-22-7 Jinnan, Shibuya",               // optional hint
  imageUrls: ["https://example.com/ramen.jpg"],     // optional, up to 5
  notes: "Best tonkotsu ramen I've ever had.",      // optional freeform
});
```

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `placeName` | `string` | Yes | Name of the place |
| `destinationName` | `string` | Yes | City or destination |
| `country` | `string` | Yes | Country |
| `address` | `string \| null` | No | Address hint (overridden by Google Places) |
| `imageUrls` | `string[]` | No | Up to 5 image URLs. Public HTTPS or private Cloudinary URLs supported. |
| `notes` | `string` | No | Freeform user notes |

Image constraints exported from the library:

```ts
import { MAX_IMAGE_COUNT, MAX_IMAGE_BYTES, ALLOWED_MEDIA_TYPES } from "scribekit";
```

## Output

The pipeline returns a `GenerateResult` with verified place details, research notes, and structured editorial content:

```ts
{
  // Verified by Google Places
  placeName, destinationName, country, address,
  latitude, longitude, phone, website,
  priceLevel, openingHours, accessibilityOptions,

  // Pipeline results
  confidence,          // "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "NONE"
  researchNotes,       // compiled research brief
  researchSources,     // URLs visited during research
  editorialContent,    // structured editorial (tagline, description, moods, tips, etc.)
  filteredImageUrls,   // images that passed the relevance filter
  errors,              // accumulated errors from any stage
  generatedAt,         // ISO timestamp
}
```

The `editorialContent` object includes: tagline, description, whyVisit, neighbourhood, localTips, whatToBring, visitDuration, bookingRequired, dressCode, indoorOutdoor, weatherDependent, seasonalTips, moods, categories, and per-field confidence levels.

## Security

URL fetching (both the research tool and image fetcher) includes layered SSRF protection:

- HTTPS-only, no credentials in URLs, no redirects
- DNS resolution with private/internal IP blocking (IPv4, IPv6, IPv4-mapped IPv6)
- Cloud metadata IP blocking (169.254.169.254, etc.)
- Response size caps and HTML stripping

## Logging

Structured logging via Pino with dual transports: colorized output to terminal and JSON to `workspace/scribekit.log`. Place context is logged once at `pipeline_start` — individual events (LLM calls, tool calls, node transitions) only carry their own fields.

```bash
npm run run:pipeline   # clear logs → run pipeline → prettify log to workspace/scribekit-pretty.log
```

Log level controlled by `LOG_LEVEL` env var (default: `info`).

## Development

```bash
npm run build          # Build with tsup (ESM)
npm test               # Run tests
npm run lint           # ESLint
```

## Project Structure

```
src/
  index.ts                    # Library entry — generate()
  cli.ts                      # CLI entry point
  context.ts                  # Input schema (Zod) + confidence levels
  state.ts                    # LangGraph Annotation state + PlaceDetails
  graph.ts                    # StateGraph — nodes + conditional edges
  logger.ts                   # Pino instance, createNodeLogger(), createPipelineLogger(), createCallbackLogger()
  agents/
    image-analysis-agent.ts   # Image filtering + visual extraction
    identification-agent.ts   # Google Places verification
    research-agent.ts         # Web research
    editorial-agent.ts        # Editorial generation
  logging/
    callback-handler.ts       # PinoCallbackHandler — LLM and tool lifecycle events
  prompts/                    # System prompts for each agent
  tools/
    fetch-url.ts              # Secure URL fetcher + HTML stripping
    google-places.ts          # Google Places API text search
  helpers/
    image-fetcher.ts          # Image fetch + base64 conversion (public + Cloudinary)
    image-constraints.ts      # Shared image limits (MAX_IMAGE_COUNT, MAX_IMAGE_BYTES, etc.)
    cloudinary-fetcher.ts     # Authenticated Cloudinary image fetching
    url-validator.ts          # SSRF-safe URL validation
```

## License

MIT
