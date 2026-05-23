import { tool } from "langchain";
import { z } from "zod";

const PLACES_API_BASE = "https://places.googleapis.com/v1/places:searchText";

const PlaceCandidate = z.object({
  name: z.string(),
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
});

export type PlaceCandidate = z.infer<typeof PlaceCandidate>;

export async function searchPlaces(query: string): Promise<PlaceCandidate[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY is not set");
  }

  const response = await fetch(PLACES_API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.internationalPhoneNumber,places.websiteUri,places.priceLevel,places.currentOpeningHours,places.accessibilityOptions",
    },
    body: JSON.stringify({ textQuery: query }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Google Places API error: HTTP ${response.status}`);
  }

  interface GooglePlace {
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    internationalPhoneNumber?: string;
    websiteUri?: string;
    priceLevel?: string;
    currentOpeningHours?: { weekdayDescriptions?: string[] };
    accessibilityOptions?: Record<string, boolean>;
  }

  const data: { places?: GooglePlace[] } = await response.json();
  const places = data.places ?? [];

  return places.map((p) => ({
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? "",
    latitude: p.location?.latitude ?? 0,
    longitude: p.location?.longitude ?? 0,
    phone: p.internationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    priceLevel: p.priceLevel ?? null,
    openingHours: p.currentOpeningHours?.weekdayDescriptions
      ? { weekdayDescriptions: p.currentOpeningHours.weekdayDescriptions }
      : null,
    accessibilityOptions: p.accessibilityOptions ?? null,
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
