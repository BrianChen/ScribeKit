import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { imageAnalysisNode } from "./agents/image-analysis-agent";
import { identificationNode } from "./agents/identification-agent";
import { researchNode } from "./agents/research-agent";
import { editorialNode } from "./agents/editorial-agent";
import { PASSING_CONFIDENCE, type ConfidenceLevel } from "./context";
import { State, type GraphState, type NodeConfig } from "./state";
import { createNodeLogger } from "./logger";

function routeAfterStart(_state: GraphState, config: NodeConfig): string {
  const log = createNodeLogger("App::Routing", null, config);
  const imageUrls = (config.configurable?.imageUrls as string[]) ?? [];

  if (imageUrls.length > 0) {
    log.info({
      event: "routing_decision",
      from: "__start__",
      to: "image-analysis-agent",
      reason: `imageUrls: ${imageUrls.length}`,
      skipped: ["identification-agent"],
    });
    return "image-analysis-agent";
  }

  log.info({
    event: "routing_decision",
    from: "__start__",
    to: "identification-agent",
    reason: "no imageUrls",
    skipped: ["image-analysis-agent"],
  });
  return "identification-agent";
}

function routeAfterIdentification(state: GraphState, config: NodeConfig): string {
  const log = createNodeLogger("App::Routing", null, config);
  const confidence = state.confidence as ConfidenceLevel;

  if (PASSING_CONFIDENCE.has(confidence)) {
    log.info({
      event: "routing_decision",
      from: "identification-agent",
      to: "research-agent",
      reason: `confidence: ${confidence}`,
      skipped: ["__end__"],
    });
    return "research-agent";
  }

  log.warn({
    event: "routing_decision",
    from: "identification-agent",
    to: "__end__",
    reason: `confidence: ${confidence}`,
    skipped: ["research-agent"],
  });
  return "__end__";
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
