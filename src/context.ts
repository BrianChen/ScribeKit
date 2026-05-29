import { z } from "zod";
import { MAX_IMAGE_COUNT } from "./helpers/image-constraints";

export const CONFIDENCE_LEVELS = ["VERY_HIGH", "HIGH", "MEDIUM", "LOW", "NONE"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const PASSING_CONFIDENCE: Set<ConfidenceLevel> = new Set(["VERY_HIGH", "HIGH", "MEDIUM"]);

export const Context = z.object({
  placeName: z.string(),
  destinationName: z.string(),
  country: z.string(),
  address: z.string().nullish(),
  imageUrls: z.array(z.string().url()).max(MAX_IMAGE_COUNT).optional(),
  notes: z.string().optional(),
});

export type Context = z.infer<typeof Context>;
