import { createAgent, providerStrategy, toolCallLimitMiddleware } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from 'zod';
import { createFetchUrl } from '../tools/fetch-url';

import { createNodeLogger } from '../logger';
import { RESEARCH_PROMPT } from '../prompts/research';
import { type GraphState, type NodeConfig } from '../state';

const ResearchOutput = z.object({
  researchNotes: z.string().describe("Research summary"),
  researchSources: z.array(z.string()).describe("URLs visited"),
}).strict();

export const researchNode = async (state: GraphState, config: NodeConfig) => {
  const log = createNodeLogger("LangGraph::Node", "research");
  log.info({ event: "node_start" });
  const startTime = Date.now();

  const fetchErrors: string[] = [];
  const fetchUrl = createFetchUrl((url, reason) => {
    fetchErrors.push(`Failed to fetch "${url}": ${reason}`);
  });

  const researchAgent = createAgent({
    model: new ChatAnthropic({
      model: "claude-haiku-4-5-20251001",
      maxTokens: 4096,
      maxRetries: 2,
    }),
    tools: [fetchUrl],
    systemPrompt: RESEARCH_PROMPT,
    responseFormat: providerStrategy(ResearchOutput),
    middleware: [toolCallLimitMiddleware({ runLimit: 3 })],
  });

  // Use same or updated place/destination/country/address from state over user input
  // stored in context/config
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
    ...(fetchErrors.length > 0 && { errors: fetchErrors }),
  };
  log.info({ event: "state_update", ...stateUpdate });
  log.info({ event: "node_end", duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` });

  return stateUpdate;
};
