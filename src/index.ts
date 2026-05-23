import { graph } from "./graph";
import { Context, type ConfidenceLevel } from "./context";
export { EditorialOutput } from "./agents/editorial-agent";

export interface GenerateInput {
  placeName: string;
  destinationName: string;
  country: string;
  address?: string | null;
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
}
