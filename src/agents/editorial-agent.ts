import { createAgent, providerStrategy } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";

import { EDITORIAL_PROMPT } from '../prompts/editorial'
import { type GraphState, type NodeConfig } from '../state'

export const EditorialOutput = z.object({
  tagline: z.string(),
  description: z.string(),
  whyVisit: z.array(z.string()),
  neighbourhood: z.string().nullable(),
  localTips: z.array(z.string()),
  whatToBring: z.array(z.string()),

  visitDuration: z.enum(["UNDER_1_HOUR", "ONE_TO_TWO_HOURS", "TWO_TO_FOUR_HOURS", "HALF_DAY", "FULL_DAY"]).nullable(),
  bookingRequired: z.boolean().nullable(),
  bookInAdvanceWarning: z.string().nullable(),
  dressCode: z.string().nullable(),
  indoorOutdoor: z.enum(["INDOOR", "OUTDOOR", "BOTH"]).nullable(),
  weatherDependent: z.boolean().nullable(),

  moods: z.array(z.enum([
    "adventurous", "relaxing", "cultural", "foodie",
    "off-the-beaten-path", "romantic", "family-friendly",
  ])),
  categories: z.array(z.enum([
    "sights-and-landmarks", "nature-outdoors", "food-and-drink",
    "nightlife", "shopping", "arts-and-entertainment",
    "activities-and-experiences", "neighborhoods",
  ])),

  seasonalTips: z.array(z.object({
    label: z.string(),
    reason: z.string(),
    avoid: z.boolean(),
  })).nullable(),

  taglineConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  descriptionConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  whyVisitConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  neighbourhoodConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  visitDurationConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  bookingRequiredConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  bookInAdvanceWarningConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  dressCodeConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  localTipsConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  whatToBringConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  indoorOutdoorConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  weatherDependentConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  moodsConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
});

const editorialAgent = createAgent({
  model: new ChatAnthropic({
    model: "claude-sonnet-4-6",
    maxTokens: 4096,
    maxRetries: 2,
  }),
  systemPrompt: EDITORIAL_PROMPT,
  responseFormat: providerStrategy(EditorialOutput),
});

export const editorialNode = async (state: GraphState, config: NodeConfig) => {
  console.log("  [editorial] starting...");

  const visualSummary = state.visualSummary || "";
  const notes = (config.configurable?.notes as string) || "";

  let userMessage = `Write editorial content using these research notes:\n\n${state.researchNotes}`;

  if (visualSummary) {
    userMessage += `\n\n## Visual observations from submitted photos\n\n${visualSummary}`;
  }

  if (notes) {
    userMessage += `\n\n## User notes (subjective, unverified)\n\n${notes}`;
  }

  const result = await editorialAgent.invoke({
    messages: [{
      role: "user",
      content: userMessage,
    }],
  });

  console.log("  [editorial] done");

  return {
    editorialContent: result.structuredResponse,
  };
};
