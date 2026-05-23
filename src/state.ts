import { Annotation, type LangGraphRunnableConfig } from "@langchain/langgraph";

export interface PlaceDetails {
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

export const State = Annotation.Root({
  visualSummary: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  identificationCues: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  filteredImageUrls: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),

  confidence: Annotation<string>({ reducer: (_, b) => b, default: () => "NONE" }),
  placeDetails: Annotation<PlaceDetails | null>({ reducer: (_, b) => b, default: () => null }),

  researchNotes: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  researchSources: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),

  editorialContent: Annotation<Record<string, unknown>>({ reducer: (_, b) => b, default: () => ({}) }),

  errors: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export type GraphState = typeof State.State;
export type NodeConfig = LangGraphRunnableConfig;
