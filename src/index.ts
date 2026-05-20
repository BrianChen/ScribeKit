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
  reservable?: boolean | null;
  openingHours?: { weekdayDescriptions: string[] } | null;
}

export interface GenerateResult {
  placeName: string;
  destinationName: string;
  researchNotes: string;
  researchSources: string[];
  editorialContent: Record<string, any>;
  errors: string[];
  generatedAt: string;
}

export async function generate(input: GenerateInput): Promise<GenerateResult> {
  const parsed = Context.parse(input);

  const result = await graph.invoke(
    {},
    { configurable: { thread_id: `${parsed.placeName}--${parsed.destinationName}`, ...parsed } }
  );

  return {
    placeName: parsed.placeName,
    destinationName: parsed.destinationName,
    researchNotes: result.researchNotes,
    researchSources: result.researchSources,
    editorialContent: result.editorialContent,
    errors: result.errors,
    generatedAt: new Date().toISOString(),
  };
}
