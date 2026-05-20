import { z } from "zod";

export const Context = z.object({
  placeName: z.string(),
  destinationName: z.string(),
  country: z.string(),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  reservable: z.boolean().nullable(),
  openingHours: z.object({
    weekdayDescriptions: z.array(z.string()),
  }).nullable(),
});

export type Context = z.infer<typeof Context>;
