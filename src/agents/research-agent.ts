import { createAgent, providerStrategy, toolCallLimitMiddleware } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from 'zod';
import fetchUrl from '../tools/fetch-url';
import { Context } from '../context';
import { RESEARCH_PROMPT } from '../prompts/research';

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
  contextSchema: Context,
  responseFormat: providerStrategy(ResearchOutput),
  middleware: [toolCallLimitMiddleware({ runLimit: 3 })],
});

export const researchNode = async (state: any, config: any) => {
  console.log("  [research] starting...");

  const result = await researchAgent.invoke({
    messages: [{
      role: "user",
      content: `Research this place: ${config.configurable.placeName} in ${config.configurable.destinationName},
${config.configurable.country}`
    }],
  }, config);

  console.log(`  [research] done`);

  return {
    researchNotes: result.structuredResponse.researchNotes,
    researchSources: result.structuredResponse.researchSources
  };
};
