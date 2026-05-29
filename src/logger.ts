import pino from "pino";
import type { NodeConfig } from "./state";

export const LAYERS = [
  "App::Pipeline",
  "App::Routing",
  "App::Node",
  "App::CLI",
  "LangGraph::Node",
  "LangGraph::LLM",
  "LangGraph::Tool",
] as const;

export type Layer = (typeof LAYERS)[number];

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "scribekit" },
  transport: {
    targets: [
      {
        target: "pino-pretty",
        options: {
          messageFormat: "{layer} │ {agent} │ {event}",
          ignore: "pid,hostname,service,layer,agent,event,threadId,placeName,destinationName,country",
          colorize: true,
        },
      },
      {
        target: "pino/file",
        options: { destination: "./logs/scribekit.log", mkdir: true },
      },
    ],
  },
});

export function createPipelineLogger(parsed: {
  placeName: string;
  destinationName: string;
  country: string;
}): pino.Logger {
  return logger.child({
    layer: "App::Pipeline" as Layer,
    agent: "",
    threadId: `${parsed.placeName}--${parsed.destinationName}`,
    placeName: parsed.placeName,
    destinationName: parsed.destinationName,
    country: parsed.country,
  });
}

export function createNodeLogger(
  layer: Layer,
  agent: string | null,
  config: NodeConfig,
): pino.Logger {
  const c = config.configurable ?? {};
  return logger.child({
    layer,
    agent: agent ?? "",
    threadId: (c.thread_id as string) ?? "",
    placeName: (c.placeName as string) ?? "",
    destinationName: (c.destinationName as string) ?? "",
    country: (c.country as string) ?? "",
  });
}

const MAX_STRING_LENGTH = 200;

export function truncateStrings(
  obj: Record<string, unknown>,
  maxLen = MAX_STRING_LENGTH,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && value.length > maxLen) {
      result[key] = `${value.slice(0, maxLen)}...(${value.length} chars)`;
    } else if (Array.isArray(value)) {
      result[key] = value;
    } else if (typeof value === "object" && value !== null) {
      result[key] = truncateStrings(value as Record<string, unknown>, maxLen);
    } else {
      result[key] = value;
    }
  }
  return result;
}
