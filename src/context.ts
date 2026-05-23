import { z } from "zod";

export const CONFIDENCE_LEVELS = ["VERY_HIGH", "HIGH", "MEDIUM", "LOW", "NONE"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const PASSING_CONFIDENCE: Set<ConfidenceLevel> = new Set(["VERY_HIGH", "HIGH", "MEDIUM"]);

export const Context = z.object({
  placeName: z.string(),
  destinationName: z.string(),
  country: z.string(),
  address: z.string().nullable(),
  imageUrls: z.array(z.string().url()).max(5).optional(),
  notes: z.string().optional(),
});

export type Context = z.infer<typeof Context>;
