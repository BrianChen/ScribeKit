import { createAgent, providerStrategy, toolCallLimitMiddleware } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from 'zod';
import fetchUrl from '../tools/fetch-url';

import { createNodeLogger, truncateStrings } from '../logger';
import { RESEARCH_PROMPT } from '../prompts/research';
import { type GraphState, type NodeConfig } from '../state';

const ResearchOutput = z.object({
  researchNotes: z.string().describe("Research summary"),
  researchSources: z.array(z.string()).describe("URLs visited"),
});

const researchAgent = createAgent({
  model: new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 2048,
    maxRetries: 2,
  }),
  tools: [fetchUrl],
  systemPrompt: RESEARCH_PROMPT,
  responseFormat: providerStrategy(ResearchOutput),
  middleware: [toolCallLimitMiddleware({ runLimit: 3 })],
});

export const researchNode = async (state: GraphState, config: NodeConfig) => {
  const log = createNodeLogger("LangGraph::Node", "research", config);
  log.info({ event: "node_start" });
  const startTime = Date.now();

  const placeDetails = state.placeDetails;
  const configurable = config.configurable ?? {};
  const placeName = placeDetails?.placeName ?? configurable.placeName;
  const destinationName = placeDetails?.destinationName ?? configurable.destinationName;
  const country = placeDetails?.country ?? configurable.country;
  const address = placeDetails?.address ?? configurable.address ?? "";

  let userMessage = `Research this place: ${placeName} in ${destinationName}, ${country}`;
  if (address) {
    userMessage += `\nAddress: ${address}`;
  }

  const result = await researchAgent.invoke({
    messages: [{
      role: "user",
      content: userMessage,
    }],
  });

  const stateUpdate = {
    researchNotes: result.structuredResponse.researchNotes,
    researchSources: result.structuredResponse.researchSources,
  };
  log.info({ event: "state_update", ...truncateStrings(stateUpdate) });
  log.info({ event: "node_end", duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` });

  return stateUpdate;
};
