# Image Ingestion & Place Identification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add image analysis and place identification agents to the ScribeKit pipeline so influencers can submit images alongside text input.

**Architecture:** Two new LangGraph nodes (image-analysis, identification) are inserted before the existing research and editorial nodes with conditional routing. The image analysis agent uses Claude Haiku's vision to filter images and extract visual details. The identification agent uses a Google Places tool to confirm the place exists and populate structured data. The graph gates on identification confidence — LOW/NONE stops the pipeline.

**Tech Stack:** LangGraph, LangChain, Claude Haiku (vision), Google Places API (New), Zod, existing url-validator.ts security layer.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/context.ts` | Remove `reservable`, add `imageUrls` and `notes` to input schema |
| Modify | `src/index.ts` | Update `GenerateInput`, `GenerateResult`, pass new fields through |
| Modify | `src/graph.ts` | New state fields, new nodes, conditional routing |
| Create | `src/helpers/image-fetcher.ts` | Fetch + validate image URLs via url-validator, return base64 |
| Create | `src/tools/google-places.ts` | Google Places API tool for LangChain |
| Create | `src/prompts/image-analysis.ts` | Prompt for image analysis agent |
| Create | `src/prompts/identification.ts` | Prompt for identification agent |
| Create | `src/agents/image-analysis-agent.ts` | Image analysis agent + node function |
| Create | `src/agents/identification-agent.ts` | Identification agent + node function |
| Modify | `src/agents/research-agent.ts` | Use verified placeDetails from state |
| Modify | `src/agents/editorial-agent.ts` | Accept visualSummary + influencer notes |
| Modify | `src/prompts/editorial.ts` | Add guidance for visual summary and influencer notes |
| Modify | `src/prompts/research.ts` | Remove reservable references, note place is pre-confirmed |
| Modify | `src/cli.ts` | Validate image count, report confidence |
| Modify | `.env.example` | Add `GOOGLE_PLACES_API_KEY` |
| Create | `src/helpers/image-fetcher.test.ts` | Tests for image fetching + validation |
| Create | `src/tools/google-places.test.ts` | Tests for Google Places tool |

---

### Task 1: Update Input Schema and Remove `reservable`

**Files:**
- Modify: `src/context.ts`
- Modify: `src/index.ts`
- Modify: `.env.example`

- [ ] **Step 1: Update Context schema in `src/context.ts`**

Remove `reservable`, add `imageUrls` and `notes`:

```typescript
import { z } from "zod";

export const Context = z.object({
  placeName: z.string(),
  destinationName: z.string(),
  country: z.string(),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  openingHours: z.object({
    weekdayDescriptions: z.array(z.string()),
  }).nullable(),
  imageUrls: z.array(z.string().url()).max(5).optional(),
  notes: z.string().optional(),
});

export type Context = z.infer<typeof Context>;
```

- [ ] **Step 2: Update `GenerateInput` and `GenerateResult` in `src/index.ts`**

```typescript
import { graph } from "./graph";
import { Context } from "./context";

export { Context } from "./context";
export { EditorialOutput } from "./agents/editorial-agent";

export interface GenerateInput {
  placeName: string;
  destinationName: string;
  country: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  openingHours?: { weekdayDescriptions: string[] } | null;
  imageUrls?: string[];
  notes?: string;
}

export interface GenerateResult {
  placeName: string;
  destinationName: string;
  country: string;
  address: string;
  latitude: number;
  longitude: number;
  openingHours: { weekdayDescriptions: string[] } | null;
  confidence: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
  researchNotes: string;
  researchSources: string[];
  editorialContent: Record<string, any>;
  filteredImageUrls: string[];
  errors: string[];
  generatedAt: string;
}

export async function generate(input: GenerateInput): Promise<GenerateResult> {
  const parsed = Context.parse(input);

  const result = await graph.invoke(
    {},
    { configurable: { thread_id: `${parsed.placeName}--${parsed.destinationName}`, ...parsed } }
  );

  const placeDetails = result.placeDetails;

  return {
    placeName: placeDetails?.placeName ?? parsed.placeName,
    destinationName: placeDetails?.destinationName ?? parsed.destinationName,
    country: placeDetails?.country ?? parsed.country,
    address: placeDetails?.address ?? parsed.address ?? "",
    latitude: placeDetails?.latitude ?? parsed.latitude ?? 0,
    longitude: placeDetails?.longitude ?? parsed.longitude ?? 0,
    openingHours: placeDetails?.openingHours ?? null,
    confidence: result.confidence,
    researchNotes: result.researchNotes,
    researchSources: result.researchSources,
    editorialContent: result.editorialContent,
    filteredImageUrls: result.filteredImageUrls,
    errors: result.errors,
    generatedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 3: Add `GOOGLE_PLACES_API_KEY` to `.env.example`**

```
ANTHROPIC_API_KEY=
GOOGLE_PLACES_API_KEY=
```

- [ ] **Step 4: Update example input JSON**

Update `examples/the-edge.json` to remove `reservable`:

```json
{
  "placeName": "The Edge",
  "destinationName": "New York",
  "country": "United States",
  "address": "30 Hudson Yards, New York, NY 10001, USA",
  "latitude": 40.7534,
  "longitude": -74.0011,
  "openingHours": null
}
```

Create `examples/influencer-submission.json` as a new example:

```json
{
  "placeName": "Ichiran Ramen",
  "destinationName": "Tokyo",
  "country": "Japan",
  "address": "1-22-7 Jinnan, Shibuya",
  "imageUrls": [
    "https://example.com/img1.jpg",
    "https://example.com/img2.jpg"
  ],
  "notes": "Best tonkotsu ramen I've ever had. The solo booth experience is so unique. Go late night to avoid lines."
}
```

- [ ] **Step 5: Commit**

```bash
git add src/context.ts src/index.ts .env.example examples/
git commit -m "feat: update input schema — remove reservable, add imageUrls and notes"
```

---

### Task 2: Image Fetcher Helper

**Files:**
- Create: `src/helpers/image-fetcher.ts`
- Create: `src/helpers/image-fetcher.test.ts`

- [ ] **Step 1: Create `src/helpers/image-fetcher.ts`**

Fetches an image URL using the existing `validateUrl` security layer, returns base64-encoded data with media type. This is used by the image analysis agent to prepare images for the Claude vision API.

```typescript
import { validateUrl } from "./url-validator";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_IMAGE_BYTES = 5_000_000; // 5MB

const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export interface FetchedImage {
  url: string;
  base64: string;
  mediaType: string;
}

export async function fetchImage(url: string): Promise<FetchedImage> {
  const validation = await validateUrl(url);
  if (!validation.safe) {
    throw new Error(`URL validation failed for ${url}: ${validation.reason}`);
  }

  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "error",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: {
      "User-Agent": "ScribeKit/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.has(contentType)) {
    throw new Error(`Unsupported image type "${contentType}" for ${url}`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds ${MAX_IMAGE_BYTES} bytes: ${url}`);
  }

  const base64 = Buffer.from(buffer).toString("base64");

  return { url, base64, mediaType: contentType };
}

export async function fetchImages(urls: string[]): Promise<{ images: FetchedImage[]; errors: string[] }> {
  const images: FetchedImage[] = [];
  const errors: string[] = [];

  const results = await Promise.allSettled(urls.map(fetchImage));

  for (const result of results) {
    if (result.status === "fulfilled") {
      images.push(result.value);
    } else {
      errors.push(result.reason.message);
    }
  }

  return { images, errors };
}
```

- [ ] **Step 2: Create `src/helpers/image-fetcher.test.ts`**

```typescript
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { fetchImage, fetchImages } from "./image-fetcher";

describe("fetchImage", () => {
  it("rejects non-HTTPS URLs", async () => {
    await assert.rejects(
      fetchImage("http://example.com/image.jpg"),
      /URL validation failed/
    );
  });

  it("rejects private IPs", async () => {
    await assert.rejects(
      fetchImage("https://192.168.1.1/image.jpg"),
      /URL validation failed/
    );
  });
});

describe("fetchImages", () => {
  it("collects errors without throwing", async () => {
    const result = await fetchImages([
      "http://example.com/a.jpg",
      "http://example.com/b.jpg",
    ]);
    assert.equal(result.images.length, 0);
    assert.equal(result.errors.length, 2);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
node --test --experimental-strip-types src/helpers/image-fetcher.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/helpers/image-fetcher.ts src/helpers/image-fetcher.test.ts
git commit -m "feat: add image fetcher helper with URL validation"
```

---

### Task 3: Google Places Tool

**Files:**
- Create: `src/tools/google-places.ts`
- Create: `src/tools/google-places.test.ts`

- [ ] **Step 1: Create `src/tools/google-places.ts`**

Uses the Google Places API (New) Text Search endpoint. Returns structured place data.

```typescript
import { tool } from "langchain";
import { z } from "zod";

const PLACES_API_BASE = "https://places.googleapis.com/v1/places:searchText";

const PlaceCandidate = z.object({
  name: z.string(),
  address: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  openingHours: z.object({
    weekdayDescriptions: z.array(z.string()),
  }).nullable(),
});

export type PlaceCandidate = z.infer<typeof PlaceCandidate>;

async function searchPlaces(query: string): Promise<PlaceCandidate[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY is not set");
  }

  const response = await fetch(PLACES_API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.currentOpeningHours",
    },
    body: JSON.stringify({ textQuery: query }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Places API error: HTTP ${response.status} — ${body}`);
  }

  const data = await response.json() as any;
  const places = data.places ?? [];

  return places.map((p: any) => ({
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? "",
    latitude: p.location?.latitude ?? 0,
    longitude: p.location?.longitude ?? 0,
    openingHours: p.currentOpeningHours?.weekdayDescriptions
      ? { weekdayDescriptions: p.currentOpeningHours.weekdayDescriptions }
      : null,
  }));
}

const googlePlaces = tool(
  async ({ query }) => {
    try {
      const candidates = await searchPlaces(query);
      if (candidates.length === 0) {
        return JSON.stringify({ candidates: [], message: "No places found" });
      }
      return JSON.stringify({ candidates: candidates.slice(0, 5) });
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : "Google Places search failed"}`;
    }
  },
  {
    name: "google_places",
    description: "Search Google Places API to find a place by name, city, and country. Returns up to 5 candidates with name, address, coordinates, and opening hours.",
    schema: z.object({
      query: z.string().describe("Search query — include place name, city, and country for best results"),
    }),
  }
);

export default googlePlaces;
export { searchPlaces };
```

- [ ] **Step 2: Create `src/tools/google-places.test.ts`**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("google_places tool", () => {
  it("throws when API key is not set", async () => {
    const original = process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;

    const { searchPlaces } = await import("./google-places");

    await assert.rejects(
      searchPlaces("Ichiran Ramen Tokyo"),
      /GOOGLE_PLACES_API_KEY is not set/
    );

    if (original) process.env.GOOGLE_PLACES_API_KEY = original;
  });
});
```

- [ ] **Step 3: Run tests**

```bash
node --test --experimental-strip-types src/tools/google-places.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/tools/google-places.ts src/tools/google-places.test.ts
git commit -m "feat: add Google Places API tool"
```

---

### Task 4: Image Analysis Agent

**Files:**
- Create: `src/prompts/image-analysis.ts`
- Create: `src/agents/image-analysis-agent.ts`

- [ ] **Step 1: Create `src/prompts/image-analysis.ts`**

```typescript
export const IMAGE_ANALYSIS_PROMPT = `You are an image analysis agent for a travel content platform. You receive photos submitted by social influencers about a place they visited.

You have two jobs:

## 1. Filter images

For each image, decide: does this image tell you something about the place?

Keep images that show the place itself — interior, exterior, food, art, decor, views, signage, or people interacting with the venue in a way that reveals something about it.

Discard images that provide no value about the place — selfies where the place isn't visible, blurry/unrecognizable photos, or images that don't convey any information about the venue.

For each image, provide a brief reason for your keep/discard decision.

## 2. Extract information

From the kept images, extract two kinds of information:

**Identification cues** — anything that helps identify what this place is:
- Readable text: signage, menus, branding, logos
- Venue type: restaurant, gallery, museum, bar, cafe, park, etc.
- Cuisine type if a food venue
- Architectural style or distinctive features
- Any neighborhood or location hints visible

**Visual summary** — what the place looks and feels like:
- Atmosphere and ambiance
- Decor and design style
- Food or art if visible
- Crowd level and clientele
- Any notable visual details

Important constraints:
- Describe only what you can see. Don't speculate beyond what's in the frame.
- Each image is a snapshot of one area — don't generalize to the whole place.
- Don't extract weather, seasonal, or time-conditional details from images.
- Keep descriptions grounded and specific rather than generic.
`;
```

- [ ] **Step 2: Create `src/agents/image-analysis-agent.ts`**

```typescript
import { createAgent, providerStrategy } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { Context } from "../context";
import { IMAGE_ANALYSIS_PROMPT } from "../prompts/image-analysis";
import { fetchImages, type FetchedImage } from "../helpers/image-fetcher";

const ImageAnalysisOutput = z.object({
  images: z.array(z.object({
    url: z.string(),
    keep: z.boolean(),
    reason: z.string(),
  })),
  identificationCues: z.string(),
  visualSummary: z.string(),
});

export { ImageAnalysisOutput };

const imageAnalysisAgent = createAgent({
  model: new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 2048,
    maxRetries: 2,
  }),
  systemPrompt: IMAGE_ANALYSIS_PROMPT,
  contextSchema: Context,
  responseFormat: providerStrategy(ImageAnalysisOutput),
});

function buildImageContent(images: FetchedImage[]): any[] {
  const content: any[] = [];
  for (const img of images) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType,
        data: img.base64,
      },
    });
  }
  content.push({
    type: "text",
    text: `Analyze these ${images.length} image(s) of a place. Filter each image and extract identification cues and a visual summary.`,
  });
  return content;
}

export const imageAnalysisNode = async (state: any, config: any) => {
  const imageUrls: string[] = config.configurable.imageUrls ?? [];

  if (imageUrls.length === 0) {
    return {
      visualSummary: "",
      identificationCues: "",
      filteredImageUrls: [],
    };
  }

  console.log(`  [image-analysis] analyzing ${imageUrls.length} image(s)...`);

  const { images: fetchedImages, errors: fetchErrors } = await fetchImages(imageUrls);

  if (fetchedImages.length === 0) {
    console.log("  [image-analysis] no images could be fetched");
    return {
      visualSummary: "",
      identificationCues: "",
      filteredImageUrls: [],
      errors: fetchErrors,
    };
  }

  const result = await imageAnalysisAgent.invoke({
    messages: [{
      role: "user",
      content: buildImageContent(fetchedImages),
    }],
  }, config);

  const response = result.structuredResponse;
  const filteredUrls = response.images
    .filter((img: any) => img.keep)
    .map((img: any) => img.url);

  console.log(`  [image-analysis] kept ${filteredUrls.length}/${fetchedImages.length} images`);

  return {
    visualSummary: response.visualSummary,
    identificationCues: response.identificationCues,
    filteredImageUrls: filteredUrls,
    errors: fetchErrors,
  };
};
```

- [ ] **Step 3: Commit**

```bash
git add src/prompts/image-analysis.ts src/agents/image-analysis-agent.ts
git commit -m "feat: add image analysis agent with vision support"
```

---

### Task 5: Identification Agent

**Files:**
- Create: `src/prompts/identification.ts`
- Create: `src/agents/identification-agent.ts`

- [ ] **Step 1: Create `src/prompts/identification.ts`**

```typescript
export const IDENTIFICATION_PROMPT = `You are a place identification agent. Your job is to confirm that a place exists and retrieve its verified details using the Google Places API.

You receive:
- A place name, destination city, and country from an influencer
- Optionally, an address hint
- Optionally, identification cues extracted from photos (signage text, venue type, cuisine, etc.)

## Process

1. Construct a search query using the place name, destination, and country. Include the address hint or identification cues if they help narrow the search.
2. Call the google_places tool to search.
3. Evaluate the results and pick the most likely match.
4. If you're not confident in any match, try alternative search queries — e.g. use identification cues if the name didn't work, or try name variations.

## Confidence levels

Rate your confidence in the match:
- **VERY_HIGH** — exact name match, address and location align perfectly
- **HIGH** — strong match with minor differences (slight name variation, nearby address)
- **MEDIUM** — likely correct but some uncertainty (partial name match, limited data to compare)
- **LOW** — weak match, probably wrong (name is different, location doesn't align)
- **NONE** — no results found or nothing remotely matches

## Output

Return the verified place details with corrected/official name, destination, country, address, coordinates, and opening hours from Google Places. Set placeConfirmed to true only when confidence is MEDIUM or higher.

Be autonomous — pick the best match using your judgment. Do not ask for clarification.
`;
```

- [ ] **Step 2: Create `src/agents/identification-agent.ts`**

```typescript
import { createAgent, providerStrategy, toolCallLimitMiddleware } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { Context } from "../context";
import { IDENTIFICATION_PROMPT } from "../prompts/identification";
import googlePlaces from "../tools/google-places";

const IdentificationOutput = z.object({
  placeConfirmed: z.boolean(),
  confidence: z.enum(["VERY_HIGH", "HIGH", "MEDIUM", "LOW", "NONE"]),
  placeDetails: z.object({
    placeName: z.string(),
    destinationName: z.string(),
    country: z.string(),
    address: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    openingHours: z.object({
      weekdayDescriptions: z.array(z.string()),
    }).nullable(),
  }).nullable(),
});

export { IdentificationOutput };

const identificationAgent = createAgent({
  model: new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 2048,
    maxRetries: 2,
  }),
  tools: [googlePlaces],
  systemPrompt: IDENTIFICATION_PROMPT,
  contextSchema: Context,
  responseFormat: providerStrategy(IdentificationOutput),
  middleware: [toolCallLimitMiddleware({ runLimit: 3 })],
});

export const identificationNode = async (state: any, config: any) => {
  console.log("  [identification] starting...");

  const { placeName, destinationName, country, address } = config.configurable;
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
  }, config);

  const response = result.structuredResponse;

  console.log(`  [identification] confidence: ${response.confidence}, confirmed: ${response.placeConfirmed}`);

  if (!response.placeConfirmed) {
    return {
      placeConfirmed: false,
      confidence: response.confidence,
      placeDetails: null,
      errors: [`Place could not be confirmed (confidence: ${response.confidence})`],
    };
  }

  return {
    placeConfirmed: response.placeConfirmed,
    confidence: response.confidence,
    placeDetails: response.placeDetails,
  };
};
```

- [ ] **Step 3: Commit**

```bash
git add src/prompts/identification.ts src/agents/identification-agent.ts
git commit -m "feat: add place identification agent with Google Places tool"
```

---

### Task 6: Update Graph — New State, Nodes, and Conditional Routing

**Files:**
- Modify: `src/graph.ts`

- [ ] **Step 1: Rewrite `src/graph.ts`**

```typescript
import { StateGraph, StateSchema, START, END, MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import { imageAnalysisNode } from "./agents/image-analysis-agent";
import { identificationNode } from "./agents/identification-agent";
import { researchNode } from "./agents/research-agent";
import { editorialNode } from "./agents/editorial-agent";

const State = new StateSchema({
  // image analysis outputs
  visualSummary: z.string().default(""),
  identificationCues: z.string().default(""),
  filteredImageUrls: z.array(z.string()).default([]),

  // identification outputs
  placeConfirmed: z.boolean().default(false),
  confidence: z.enum(["VERY_HIGH", "HIGH", "MEDIUM", "LOW", "NONE"]).default("NONE"),
  placeDetails: z.object({
    placeName: z.string(),
    destinationName: z.string(),
    country: z.string(),
    address: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    openingHours: z.object({
      weekdayDescriptions: z.array(z.string()),
    }).nullable(),
  }).nullable().default(null),

  // research outputs
  researchNotes: z.string().default(""),
  researchSources: z.array(z.string()).default([]),

  // editorial outputs
  editorialContent: z.record(z.string(), z.any()),

  errors: z.array(z.string()).default([]),
});

function routeAfterStart(_state: any, config: any): string {
  const imageUrls = config.configurable.imageUrls ?? [];
  return imageUrls.length > 0 ? "image-analysis" : "identification";
}

function routeAfterIdentification(state: any): string {
  const passing = new Set(["VERY_HIGH", "HIGH", "MEDIUM"]);
  return passing.has(state.confidence) ? "research-agent" : "__end__";
}

const workflow = new StateGraph(State)
  .addNode("image-analysis", imageAnalysisNode, { retryPolicy: { maxAttempts: 1 } })
  .addNode("identification", identificationNode, { retryPolicy: { maxAttempts: 1 } })
  .addNode("research-agent", researchNode, { retryPolicy: { maxAttempts: 1 } })
  .addNode("editorial-agent", editorialNode, { retryPolicy: { maxAttempts: 1 } })
  .addConditionalEdges(START, routeAfterStart)
  .addEdge("image-analysis", "identification")
  .addConditionalEdges("identification", routeAfterIdentification)
  .addEdge("research-agent", "editorial-agent")
  .addEdge("editorial-agent", END);

const checkpointer = new MemorySaver();

export const graph = workflow.compile({ checkpointer });
```

- [ ] **Step 2: Commit**

```bash
git add src/graph.ts
git commit -m "feat: add image-analysis and identification nodes with conditional routing"
```

---

### Task 7: Update Research Agent to Use Verified placeDetails

**Files:**
- Modify: `src/agents/research-agent.ts`
- Modify: `src/prompts/research.ts`

- [ ] **Step 1: Update `src/agents/research-agent.ts`**

The research agent now reads verified `placeDetails` from state instead of using raw `configurable` fields.

```typescript
import { createAgent, providerStrategy, toolCallLimitMiddleware } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import fetchUrl from "../tools/fetch-url";
import { Context } from "../context";
import { RESEARCH_PROMPT } from "../prompts/research";

const ResearchOutput = z.object({
  researchNotes: z.string().describe("Research summary"),
  researchSources: z.array(z.string()).describe("URLs visited"),
});

const researchAgent = createAgent({
  model: new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 2048,
    maxRetries: 2,
  }),
  tools: [fetchUrl],
  systemPrompt: RESEARCH_PROMPT,
  contextSchema: Context,
  responseFormat: providerStrategy(ResearchOutput),
  middleware: [toolCallLimitMiddleware({ runLimit: 3 })],
});

export const researchNode = async (state: any, config: any) => {
  console.log("  [research] starting...");

  const placeDetails = state.placeDetails;
  const placeName = placeDetails?.placeName ?? config.configurable.placeName;
  const destinationName = placeDetails?.destinationName ?? config.configurable.destinationName;
  const country = placeDetails?.country ?? config.configurable.country;
  const address = placeDetails?.address ?? config.configurable.address ?? "";

  let userMessage = `Research this place: ${placeName} in ${destinationName}, ${country}`;
  if (address) {
    userMessage += `\nAddress: ${address}`;
  }

  const result = await researchAgent.invoke({
    messages: [{
      role: "user",
      content: userMessage,
    }],
  }, config);

  console.log("  [research] done");

  return {
    researchNotes: result.structuredResponse.researchNotes,
    researchSources: result.structuredResponse.researchSources,
  };
};
```

- [ ] **Step 2: Update `src/prompts/research.ts`**

Remove the reference to `reservable` and add a note that the place has been pre-confirmed. Replace the full file:

```typescript
export const RESEARCH_PROMPT = `You are a travel research agent. Your job is to gather detailed information about a specific place that will be used by an editorial writer to create travel content.

The place has already been confirmed to exist. You have access to its verified name, destination, country, and address.

## What to research

Gather information on these topics (The editorial writer needs this information to write a detailed, helpful, positive but honest blog):

1. **Practical details:** (these are more factual rather than vibes)
   - Is booking/reservation required or recommended? How far in advance?
   - Any dress code requirements?
   - Typical visit duration needed
   - What to bring (if relevant — mainly for outdoor/activity places)
   - Indoor, outdoor, or both?
   - Weather dependent - would weather hugely impact the experience?
   - Neighbourhood/district/area - what specific neighborhood/district/area is this place in, what is the name of it?
2. **History and significance** — when was it built/founded, what's its reputation
3. **The visitor experience** — What is the experience like for visitors? What do they see? What do they do? What is the atmosphere like?
4. **Seasonal considerations** — best/worst times to visit, crowds, events, closures, weather impact (maybe this doesn't apply to the place)
5. **Local tips** — These are genuinely helpful advice that is either really important or lesser known advice that is still helpful to travelers.
6. **Vibe/mood** — is it adventurous, relaxing, cultural, romantic, family friendly? Is it for people who enjoy food? Would kids enjoy it?
7. **Uniqueness** - What makes this place special and why do people visit? What do visitors enjoy the most about this place? How does it make them feel (if applicable)?

## How to research

- Start with what you already know about the place
- For details you're unsure about use fetch_url tool to visit relevant pages
   - Don't over fetch, gather all information you're unsure about and make optimized fetches.
   - What are you unsure about?
      - Factual information? Try official sites, travel blogs like TripAdvisor, Klook
      - Vibes/experiences/sentiment information? Try travel sites with reviews like TripAdvisor reviews, Lonely Planet reviews, editorial sites
- Fetch tool rules:
   - only fetch secure sources (https://)
- If you can't find reliable information on a topic thats fine, don't guess or make things up

## Output

Write a comprehensive research brief covering all the topics above. Be specific and detailed. The editorial writer will use this to create polished travel content. Their goal is to write content that makes people think - Wow I want to visit now.
`;
```

- [ ] **Step 3: Commit**

```bash
git add src/agents/research-agent.ts src/prompts/research.ts
git commit -m "feat: research agent uses verified placeDetails from identification"
```

---

### Task 8: Update Editorial Agent to Accept Visual Summary and Notes

**Files:**
- Modify: `src/agents/editorial-agent.ts`
- Modify: `src/prompts/editorial.ts`

- [ ] **Step 1: Update `src/agents/editorial-agent.ts`**

The editorial agent now receives `visualSummary` from state and influencer `notes` from configurable.

```typescript
import { createAgent, providerStrategy } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { Context } from "../context";
import { EDITORIAL_PROMPT } from "../prompts/editorial";

const EditorialOutput = z.object({
  tagline: z.string(),
  description: z.string(),
  whyVisit: z.array(z.string()),
  neighbourhood: z.string().nullable(),
  localTips: z.array(z.string()),
  whatToBring: z.array(z.string()),

  visitDuration: z.enum(["UNDER_1_HOUR", "ONE_TO_TWO_HOURS", "TWO_TO_FOUR_HOURS", "HALF_DAY", "FULL_DAY"]).nullable(),
  bookingRequired: z.boolean().nullable(),
  bookInAdvanceWarning: z.string().nullable(),
  dressCode: z.string().nullable(),
  indoorOutdoor: z.enum(["INDOOR", "OUTDOOR", "BOTH"]).nullable(),
  weatherDependent: z.boolean().nullable(),

  moods: z.array(z.enum([
    "adventurous", "relaxing", "cultural", "foodie",
    "off-the-beaten-path", "romantic", "family-friendly",
  ])),
  categories: z.array(z.enum([
    "sights-and-landmarks", "nature-outdoors", "food-and-drink",
    "nightlife", "shopping", "arts-and-entertainment",
    "activities-and-experiences", "neighborhoods",
  ])),

  seasonalTips: z.array(z.object({
    label: z.string(),
    reason: z.string(),
    avoid: z.boolean(),
  })).nullable(),

  taglineConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  descriptionConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  whyVisitConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  neighbourhoodConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  visitDurationConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  bookingRequiredConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  bookInAdvanceWarningConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  dressCodeConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  localTipsConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  whatToBringConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  indoorOutdoorConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  weatherDependentConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  moodsConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
});

export { EditorialOutput };

const editorialAgent = createAgent({
  model: new ChatAnthropic({
    model: "claude-sonnet-4-6",
    maxTokens: 4096,
    maxRetries: 2,
  }),
  systemPrompt: EDITORIAL_PROMPT,
  contextSchema: Context,
  responseFormat: providerStrategy(EditorialOutput),
});

export const editorialNode = async (state: any, config: any) => {
  console.log("  [editorial] starting...");

  const visualSummary = state.visualSummary || "";
  const notes = config.configurable.notes || "";

  let userMessage = `Write editorial content using these research notes:\n\n${state.researchNotes}`;

  if (visualSummary) {
    userMessage += `\n\n## Visual observations from submitted photos\n\n${visualSummary}`;
  }

  if (notes) {
    userMessage += `\n\n## Influencer notes (subjective, unverified)\n\n${notes}`;
  }

  const result = await editorialAgent.invoke({
    messages: [{
      role: "user",
      content: userMessage,
    }],
  }, config);

  console.log("  [editorial] done");

  return {
    editorialContent: result.structuredResponse,
  };
};
```

- [ ] **Step 2: Update `src/prompts/editorial.ts`**

Add guidance for visual summary and influencer notes at the end of the existing prompt. Append after the confidence levels section, before the closing backtick:

Find this text at the end of the prompt:
```
If the research notes don't cover a topic, mark the confidence LOW and keep the content conservative rather than guessing. A null value with HIGH confidence ("I'm sure this doesn't apply") is better than fabricated content with LOW confidence.
```

Add after it:

```

## Visual observations

You may receive visual observations extracted from photos submitted by the influencer. These are snapshots of specific areas of the place — not comprehensive descriptions. Use them to add color and texture to your writing (decor, atmosphere, food presentation) but don't generalize a single photo's details to the entire venue.

## Influencer notes

You may receive freeform notes from the influencer who submitted this place. Treat these as subjective, unverified personal perspective. They're useful for adding a personal angle and may highlight what makes the place special, but don't treat claims as facts. Cross-reference with the research notes when possible.
```

Also remove the reference to `reservable` in the `bookingRequired` field guidance. Change:

```
**bookingRequired** — Whether booking is practically necessary. The context may include a "reservable" flag from Google Places, but that only means the venue accepts reservations — it does not mean booking is required. Set true only if failing to book would meaningfully affect the visit (sold out, long queues, timed entry). Default to null if unsure.
```

To:

```
**bookingRequired** — Whether booking is practically necessary. Set true only if failing to book would meaningfully affect the visit (sold out, long queues, timed entry). Default to null if unsure.
```

- [ ] **Step 3: Commit**

```bash
git add src/agents/editorial-agent.ts src/prompts/editorial.ts
git commit -m "feat: editorial agent accepts visual summary and influencer notes"
```

---

### Task 9: Update CLI

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Update `src/cli.ts`**

Add support for `imageUrls` and `notes` from the input JSON. No new CLI flags needed — these fields are just read from the input JSON like everything else. But update the validation to reflect the new required/optional fields:

```typescript
#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import { generate } from "./index";

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
      console.error("Input JSON must include placeName and destinationName.");
      process.exit(1);
    }

    if (input.imageUrls && input.imageUrls.length > 5) {
      console.error("Maximum 5 image URLs allowed.");
      process.exit(1);
    }

    console.log(`Generating content for: ${input.placeName} (${input.destinationName})...`);
    if (input.imageUrls?.length) {
      console.log(`  Processing ${input.imageUrls.length} image(s)...`);
    }
    console.log();

    const result = await generate(input);

    if (result.errors.length > 0) {
      console.error(`\nErrors: ${result.errors.join("\n")}`);
    }

    if (result.confidence === "LOW" || result.confidence === "NONE") {
      console.error(`\nPlace could not be confirmed (confidence: ${result.confidence}). Pipeline stopped.`);
    }

    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nOutput written to ${outputPath}`);
  });

program.parse();
```

- [ ] **Step 2: Commit**

```bash
git add src/cli.ts
git commit -m "feat: CLI supports image URLs and reports identification confidence"
```

---

### Task 10: Integration Test — End-to-End Smoke Test

**Files:**
- Modify: `examples/influencer-submission.json` (created in Task 1)

- [ ] **Step 1: Run with existing input (no images, backwards compatibility)**

```bash
npm run dev -- generate --input examples/the-edge.json --output result-edge.json
```

Expected: Pipeline runs through identification → research → editorial → output. No image analysis step. Output includes `confidence` field and `filteredImageUrls: []`.

- [ ] **Step 2: Run with influencer submission (with images)**

Update `examples/influencer-submission.json` with real image URLs if available, then run:

```bash
npm run dev -- generate --input examples/influencer-submission.json --output result-influencer.json
```

Expected: Pipeline runs through image-analysis → identification → research → editorial → output. Output includes `filteredImageUrls` with kept images.

- [ ] **Step 3: Verify early termination**

Create `examples/unknown-place.json`:

```json
{
  "placeName": "Xyzzy Nonexistent Place 12345",
  "destinationName": "Nowhere",
  "country": "Fakeland"
}
```

```bash
npm run dev -- generate --input examples/unknown-place.json --output result-unknown.json
```

Expected: Pipeline stops after identification with confidence LOW or NONE. Output has empty `editorialContent` and `researchNotes`, and `errors` array explains the failure.

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: All existing and new tests pass.

- [ ] **Step 5: Commit test examples**

```bash
git add examples/unknown-place.json
git commit -m "test: add integration test examples for image ingestion pipeline"
```
