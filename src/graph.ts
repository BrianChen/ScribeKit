import { StateGraph, StateSchema, START, END, MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import { researchNode } from "./agents/research-agent";
import { editorialNode } from "./agents/editorial-agent";

const State = new StateSchema({
  researchNotes: z.string().default(""),
  researchSources: z.array(z.string()).default([]),
  editorialContent: z.record(z.string(), z.any()),
  errors: z.array(z.string()).default([]),
});

const workflow = new StateGraph(State)
  .addNode('research-agent', researchNode, { retryPolicy: { maxAttempts: 1 } })
  .addNode('editorial-agent', editorialNode, { retryPolicy: { maxAttempts: 1 } })
  .addEdge(START, 'research-agent')
  .addEdge('research-agent', 'editorial-agent')
  .addEdge('editorial-agent', END);

const checkpointer = new MemorySaver();

export const graph = workflow.compile({ checkpointer });
