import pino from "pino";

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
          ignore: "pid,hostname,service,layer,agent,event",
          colorize: true,
        },
      },
      {
        target: "pino/file",
        options: { destination: "./workspace/scribekit.log", mkdir: true },
      },
    ],
  },
});

export function createPipelineLogger(): pino.Logger {
  return logger.child({ layer: "App::Pipeline" as Layer, agent: "" });
}

export function createCallbackLogger(): pino.Logger {
  return logger.child({ layer: "LangGraph::LLM" as Layer, agent: "" });
}

export function createNodeLogger(layer: Layer, agent: string | null): pino.Logger {
  return logger.child({ layer, agent: agent ?? "" });
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
