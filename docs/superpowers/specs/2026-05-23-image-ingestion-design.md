# Image Ingestion & Place Identification — Design Spec

## Overview

Expand ScribeKit to accept image inputs alongside place submissions (restaurants, art galleries, museums, lesser-known places). This adds two new agents to the pipeline: an image analysis agent and a place identification agent, inserted before the existing research and editorial agents.

## Use Case

Users submit places they've visited. Input is semi-structured: place name and city (required), plus optional address, freeform notes, and up to 5 image URLs. The system processes images to extract visual details, confirms the place exists via Google Places, researches it, and produces editorial content along with filtered valuable images.

## Pipeline

```
START → (has images?) → image-analysis-agent → identification-agent → (confidence >= MEDIUM?) → research-agent → editorial-agent → END
                      → identification-agent → (confidence >= MEDIUM?) → research-agent → editorial-agent → END
                                                                      → END (error)
```

Two conditional edges:
1. **After START** — routes to `image-analysis-agent` if `imageUrls` is present and non-empty, otherwise skips to `identification-agent`.
2. **After identification-agent** — routes to `research-agent` if confidence is VERY_HIGH, HIGH, or MEDIUM. Routes to END if confidence is LOW or NONE.

## Input Schema

Input schema:

```typescript
interface GenerateInput {
  placeName: string;
  destinationName: string;
  country: string;
  address?: string | null;      // optional hint, overridden by Google Places
  imageUrls?: string[];         // optional, up to 5
  notes?: string;               // optional freeform
}
```

- `reservable`, `latitude`, `longitude`, and `openingHours` removed from the input schema entirely.
- `address`, `latitude`, `longitude`, `phone`, `website`, `priceLevel`, `openingHours`, and `accessibilityOptions` are populated by the identification agent from Google Places.
- The submitted `address` is an optional hint used by the identification agent during search, but the Google Places result overrides it.

## Graph State

Uses LangGraph's `Annotation` API (not `StateSchema`, which is incompatible with Zod 3.x):

```typescript
interface PlaceDetails {
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
}

const State = Annotation.Root({
  // image analysis outputs
  visualSummary: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  identificationCues: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  filteredImageUrls: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),

  // identification outputs
  confidence: Annotation<string>({ reducer: (_, b) => b, default: () => "NONE" }),
  placeDetails: Annotation<PlaceDetails | null>({ reducer: (_, b) => b, default: () => null }),

  // research outputs
  researchNotes: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  researchSources: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),

  // editorial outputs
  editorialContent: Annotation<Record<string, any>>({ reducer: (_, b) => b, default: () => ({}) }),

  errors: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});
```

## Agent 1: Image Analysis

**File:** `src/agents/image-analysis-agent.ts`
**Model:** claude-haiku-4-5-20251001 (vision)
**Tools:** None

### Behavior

- Receives all image URLs (up to 5) in a single vision call.
- Images are fetched and validated through the existing `url-validator.ts` security layer (SSRF protection, HTTPS-only, private IP blocking), then converted to base64 for the vision API.
- Produces per-image output, each with:
  1. **Filtering verdict** — does this image tell you something about the place? Keep or discard with a reason.
  2. **Identification cues** — signage text, venue type, cuisine, architectural style, neighborhood/location hints. Only populated for kept images.
  3. **Visual summary** — atmosphere, decor, vibe, food/art descriptions. Only populated for kept images.
- The node function merges only kept images' cues and summaries into the state strings (joined with double newlines). Discarded images contribute nothing to downstream agents.

### Filtering Criteria

The model uses judgment to determine if each image provides value about the place. The principle: does this image tell you something about the place?

Examples for illustration (not hardcoded rules):
- A photo of the restaurant interior showing decor and ambiance → keep
- A person holding up a dish at the restaurant → keep
- A bathroom mirror selfie where nothing about the place is visible → discard
- A blurry, unrecognizable photo → discard

### Visual Summary Guidance

- Describe only what's visually evident; don't speculate beyond the frame.
- Acknowledge each image is a snapshot of one area, not the whole place.
- No weather, seasonal, or time-conditional details from images.

### Structured Output

```typescript
const ImageAnalysisOutput = z.object({
  images: z.array(z.object({
    url: z.string(),
    keep: z.boolean(),
    reason: z.string(),
    identificationCues: z.string(),
    visualSummary: z.string(),
  })),
});
```

## Agent 2: Place Identification

**File:** `src/agents/identification-agent.ts`
**Model:** claude-haiku-4-5-20251001
**Tools:** `google_places`

### Tool: google_places

**File:** `src/tools/google-places.ts`

- Searches Google Places API (Text Search) using place name, city, country, and optional address hint.
- Returns top candidates with: name, address, coordinates, phone, website, priceLevel, opening hours, accessibilityOptions.
- Requires `GOOGLE_PLACES_API_KEY` in `.env`.

### Behavior

- Receives the submitted input (place name, destination, country, address hint) plus identification cues from image analysis (if images were provided).
- Calls `google_places` to search for the place.
- Picks the most likely match from candidates — no user interaction.
- Returns verified/corrected place data with a confidence level.
- Fully autonomous — no user clarification at any point.

### Confidence Levels

- **VERY_HIGH** — exact match (name, address, everything lines up)
- **HIGH** — strong match, minor differences (e.g. slight name variation)
- **MEDIUM** — likely correct but some uncertainty
- **LOW** — weak match, probably wrong
- **NONE** — nothing found at all

### Gate Logic

VERY_HIGH, HIGH, or MEDIUM → continue to research agent. LOW or NONE → end the graph with an error.

### Structured Output

```typescript
const IdentificationOutput = z.object({
  confidence: z.enum(["VERY_HIGH", "HIGH", "MEDIUM", "LOW", "NONE"]),
  placeDetails: z.object({
    placeName: z.string(),
    destinationName: z.string(),
    country: z.string(),
    address: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    phone: z.string().nullable(),
    website: z.string().nullable(),
    priceLevel: z.string().nullable(),
    openingHours: z.object({
      weekdayDescriptions: z.array(z.string()),
    }).nullable(),
    accessibilityOptions: z.record(z.boolean()).nullable(),
  }).nullable(),
});
```

## Existing Agent Changes

### Research Agent

- Uses verified `placeDetails` from state as its context (confirmed name, destination, country, address, coordinates, phone, website, priceLevel, opening hours, accessibilityOptions).
- Does **not** receive identification cues or user notes.
- Assumes the place exists and has been confirmed.
- No other changes to its behavior or prompt structure.

### Editorial Agent

- Receives `visualSummary` from state as additional context alongside research notes.
- Receives user `notes` from configurable as subjective input.
- Prompt updated to instruct it to treat visual summary as snapshots of specific areas (not comprehensive) and notes as subjective perspective (not verified facts).
- `filteredImageUrls` pass through state untouched to the final output.

## Output

```typescript
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
  accessibilityOptions: Record<string, boolean> | null; // from Google Places
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

## Security

- Image URLs validated through existing `url-validator.ts` (SSRF protection, HTTPS-only, private IP blocking, no redirects).
- Google Places API key stored in `.env`, not hardcoded.

## Data Flow Summary

| Agent | Receives | Produces |
|-------|----------|----------|
| **Image analysis** | image URLs | identificationCues, visualSummary, filteredImageUrls |
| **Identification** | submitted input (name, city, country, address hint) + identificationCues | confidence, placeDetails (name, address, coords, phone, website, priceLevel, openingHours, accessibilityOptions) |
| **Research** | verified placeDetails | researchNotes, researchSources |
| **Editorial** | researchNotes + visualSummary + user notes (subjective) | editorialContent |