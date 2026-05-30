import { graph } from "./graph";
import { Context, type ConfidenceLevel, PASSING_CONFIDENCE } from "./context";
import { createPipelineLogger, createCallbackLogger } from "./logger";
import { PinoCallbackHandler } from "./logging/callback-handler";
import { BaseLangGraphError } from "@langchain/langgraph";
import { ScribeKitError } from "./errors";
import { type GraphState } from "./state";
export { EditorialOutput } from "./agents/editorial-agent";
export { MAX_IMAGE_COUNT, MAX_IMAGE_BYTES, ALLOWED_MEDIA_TYPES } from "./helpers/image-constraints";
export { ScribeKitError } from "./errors";

export interface GenerateInput {
  placeName: string;
  destinationName: string;
  country: string;
  address?: string | null;
  imageUrls?: string[];
  notes?: string;
}

export interface GenerateResult {
  ok: boolean;
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
  let parsed: Context;
  try {
    parsed = Context.parse(input);
  } catch (e) {
    throw new ScribeKitError(e instanceof Error ? e.message : "Invalid input", { cause: e });
  }

  const pipelineLog = createPipelineLogger();
  const callbackHandler = new PinoCallbackHandler(createCallbackLogger());

  pipelineLog.info({
    event: "pipeline_start",
    placeName: parsed.placeName,
    destinationName: parsed.destinationName,
    country: parsed.country,
    imageCount: parsed.imageUrls?.length ?? 0,
    ...(parsed.imageUrls?.length && { imageUrls: parsed.imageUrls }),
    ...(parsed.notes && { notes: parsed.notes }),
  });

  const startTime = Date.now();

  let result!: GraphState;
  try {
    result = await graph.invoke(
      {},
      {
        callbacks: [callbackHandler],
        configurable: { thread_id: `${parsed.placeName}--${parsed.destinationName}`, ...parsed },
      },
    );
  } catch (e) {
    if (e instanceof BaseLangGraphError) {
      throw new ScribeKitError("ScribeKit encountered an internal error.", { cause: e });
    }
    throw new ScribeKitError(
      e instanceof Error ? e.message : "Pipeline failed",
      { cause: e },
    );
  }

  const placeDetails = result.placeDetails;
  const output: GenerateResult = {
    ok: PASSING_CONFIDENCE.has(result.confidence as ConfidenceLevel),
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

  const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

  if (output.errors.length > 0) {
    pipelineLog.warn({
      event: "pipeline_end",
      duration,
      confidence: output.confidence,
      errorCount: output.errors.length,
      errors: output.errors,
    });
  } else {
    pipelineLog.info({
      event: "pipeline_end",
      duration,
      confidence: output.confidence,
      errorCount: 0,
    });
  }

  return output;
}
