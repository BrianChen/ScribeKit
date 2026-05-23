import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { imageAnalysisNode } from "./agents/image-analysis-agent";
import { identificationNode } from "./agents/identification-agent";
import { researchNode } from "./agents/research-agent";
import { editorialNode } from "./agents/editorial-agent";
import { PASSING_CONFIDENCE, type ConfidenceLevel } from "./context";
import { State, type GraphState, type NodeConfig } from "./state";

function routeAfterStart(_state: GraphState, config: NodeConfig): string {
  const imageUrls = (config.configurable?.imageUrls as string[]) ?? [];
  return imageUrls.length > 0 ? "image-analysis-agent" : "identification-agent";
}

function routeAfterIdentification(state: GraphState): string {
  return PASSING_CONFIDENCE.has(state.confidence as ConfidenceLevel) ? "research-agent" : "__end__";
}

const workflow = new StateGraph(State)
  .addNode("image-analysis-agent", imageAnalysisNode, { retryPolicy: { maxAttempts: 1 } })
  .addNode("identification-agent", identificationNode, { retryPolicy: { maxAttempts: 1 } })
  .addNode("research-agent", researchNode, { retryPolicy: { maxAttempts: 1 } })
  .addNode("editorial-agent", editorialNode, { retryPolicy: { maxAttempts: 1 } })
  .addConditionalEdges(START, routeAfterStart)
  .addEdge("image-analysis-agent", "identification-agent")
  .addConditionalEdges("identification-agent", routeAfterIdentification)
  .addEdge("research-agent", "editorial-agent")
  .addEdge("editorial-agent", END);

const checkpointer = new MemorySaver();

export const graph = workflow.compile({ checkpointer });
