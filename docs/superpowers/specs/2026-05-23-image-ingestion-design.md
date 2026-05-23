# Image Ingestion & Place Identification — Design Spec

## Overview

Expand ScribeKit to accept image inputs from social influencers submitting local hidden gems (restaurants, art galleries, museums, lesser-known places). This adds two new agents to the pipeline: an image analysis agent and a place identification agent, inserted before the existing research and editorial agents.

## Use Case

Social influencers submit places they've visited. Their input is semi-structured: place name and city (required), plus optional address, freeform notes, and up to 5 image URLs. The system processes images to extract visual details, confirms the place exists via Google Places, researches it, and produces editorial content along with filtered valuable images.

## Pipeline

```
START → (has images?) → image-analysis → identification → (confidence >= MEDIUM?) → research → editorial → END
                      → identification → (confidence >= MEDIUM?) → research → editorial → END
                                                                → END (error)
```

Two conditional edges:
1. **After START** — routes to `image-analysis` if `imageUrls` is present and non-empty, otherwise skips to `identification`.
2. **After identification** — routes to `research-agent` if confidence is VERY_HIGH, HIGH, or MEDIUM. Routes to END if confidence is LOW or NONE.

## Input Schema

Influencer-facing input:

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

- `reservable` removed from the schema entirely.
- `address`, `latitude`, `longitude`, `openingHours` are populated by the identification agent from Google Places, not from the influencer's input.
- The influencer's `address` is an optional hint used by the identification agent during search, but the Google Places result overrides it.

## Graph State

```typescript
const State = new StateSchema({
  // image analysis outputs
  visualSummary: z.string().default(""),
  identificationCues: z.string().default(""),
  filteredImageUrls: z.array(z.string()).default([]),

  // identification outputs
  placeConfirmed: z.boolean().default(false),  // derived: true when confidence >= MEDIUM
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
```

## Agent 1: Image Analysis

**File:** `src/agents/image-analysis-agent.ts`
**Model:** claude-haiku-4-5-20251001 (vision)
**Tools:** None

### Behavior

- Receives all image URLs (up to 5) in a single vision call.
- Images are fetched and validated through the existing `url-validator.ts` security layer (SSRF protection, HTTPS-only, private IP blocking), then converted to base64 for the vision API.
- Produces three outputs:
  1. **Per-image filtering verdict** — does this image tell you something about the place? Keep or discard with a reason.
  2. **Identification cues** — signage text, venue type, cuisine, architectural style, neighborhood/location hints. Consumed by the identification agent.
  3. **Visual summary** — atmosphere, decor, vibe, food/art descriptions. Consumed by the editorial agent.

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
  })),
  identificationCues: z.string(),
  visualSummary: z.string(),
});
```

## Agent 2: Place Identification

**File:** `src/agents/identification-agent.ts`
**Model:** claude-haiku-4-5-20251001
**Tools:** `google_places`

### Tool: google_places

**File:** `src/tools/google-places.ts`

- Searches Google Places API (Text Search or Find Place) using place name, city, country, and optional address hint.
- Returns top candidates with: name, address, coordinates, opening hours, place ID.
- Requires `GOOGLE_PLACES_API_KEY` in `.env`.

### Behavior

- Receives the influencer's input (place name, destination, country, address hint) plus identification cues from image analysis (if images were provided).
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
```

## Existing Agent Changes

### Research Agent

- Uses verified `placeDetails` from state as its context (confirmed name, destination, country, address, coordinates, opening hours).
- Does **not** receive identification cues or influencer notes.
- Assumes the place exists and has been confirmed.
- No other changes to its behavior or prompt structure.

### Editorial Agent

- Receives `visualSummary` from state as additional context alongside research notes.
- Receives influencer `notes` from configurable as subjective input.
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
  openingHours: { weekdayDescriptions: string[] } | null;
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
| **Identification** | influencer input (name, city, country, address hint) + identificationCues | placeConfirmed, confidence, placeDetails |
| **Research** | verified placeDetails | researchNotes, researchSources |
| **Editorial** | researchNotes + visualSummary + influencer notes (subjective) | editorialContent |

## Future Considerations

- **Influencer notes filtering:** The influencer's freeform notes may need a filtering/cleaning step before being passed to the editorial agent to strip out inaccuracies, irrelevant content, or poorly formatted text. Not in scope for this iteration but should be considered.
- **Fallback for places not on Google Places:** New, informal, or unlisted places (e.g. a brand new restaurant, an unnamed street food stall) will be rejected under the current gate logic. A future iteration could have the research agent act as a secondary verification step — searching the web for evidence the place exists (social media, review sites, blog mentions) and upgrading the confidence if found. This would let the pipeline handle places that are real but not yet indexed by Google.
- **Video input:** Influencers also post IG reels describing places. Would require audio transcription (Whisper, Deepgram) and key frame extraction. Deferred — start with images first.
- **Editorial schema cleanup:** The existing `EditorialOutput` has `bookingRequired` which referenced the now-removed `reservable` field. The editorial prompt and schema should be reviewed to ensure they don't depend on removed input fields.
- **Factual fields redistribution:** Several editorial output fields are factual rather than creative (neighbourhood, visitDuration, bookingRequired, bookInAdvanceWarning, dressCode, indoorOutdoor, weatherDependent, seasonalTips). These may be better owned by the research agent, which has direct access to factual sources. Currently kept in editorial for simplicity — revisit in a future iteration.
