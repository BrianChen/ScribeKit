import { createAgent, providerStrategy, toolCallLimitMiddleware } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { CONFIDENCE_LEVELS, PASSING_CONFIDENCE } from "../context";
import { createNodeLogger, truncateStrings } from "../logger";
import { IDENTIFICATION_PROMPT } from "../prompts/identification";
import { type GraphState, type NodeConfig } from "../state";
import googlePlaces from "../tools/google-places";

export const IdentificationOutput = z.object({
  confidence: z.enum(CONFIDENCE_LEVELS),
  placeDetails: z.object({
    placeName: z.string(),
    destinationName: z.string(),
    country: z.string(),
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
  }).nullable(),
});

const identificationAgent = createAgent({
  model: new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 2048,
    maxRetries: 2,
  }),
  tools: [googlePlaces],
  systemPrompt: IDENTIFICATION_PROMPT,
  responseFormat: providerStrategy(IdentificationOutput),
  middleware: [toolCallLimitMiddleware({ runLimit: 1 })],
});

export const identificationNode = async (state: GraphState, config: NodeConfig) => {
  const log = createNodeLogger("LangGraph::Node", "identification", config);
  log.info({ event: "node_start" });
  const startTime = Date.now();

  const { placeName, destinationName, country, address } = config.configurable ?? {};
  const identificationCues = state.identificationCues || "";

  let userMessage = `Identify and confirm this place: "${placeName}" in ${destinationName}, ${country}`;
  if (address) {
    userMessage += `\nAddress hint: ${address}`;
  }
  if (identificationCues) {
    userMessage += `\nIdentification cues from photos: ${identificationCues}`;
  }

  const result = await identificationAgent.invoke({
    messages: [{
      role: "user",
      content: userMessage,
    }],
  });

  const response = result.structuredResponse;

  if (!PASSING_CONFIDENCE.has(response.confidence)) {
    const stateUpdate = {
      confidence: response.confidence,
      placeDetails: null,
      errors: [`Place could not be confirmed (confidence: ${response.confidence})`],
    };
    log.warn({ event: "state_update", ...truncateStrings(stateUpdate) });
    log.info({ event: "node_end", duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` });
    return stateUpdate;
  }

  const stateUpdate = {
    confidence: response.confidence,
    placeDetails: response.placeDetails,
  };
  log.info({ event: "state_update", ...truncateStrings(stateUpdate as Record<string, unknown>) });
  log.info({ event: "node_end", duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` });

  return stateUpdate;
};
