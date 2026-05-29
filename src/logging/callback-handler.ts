import type pino from "pino";
import { BaseTracer, type Run } from "@langchain/core/tracers/base";

const MAX_OUTPUT_LENGTH = 500;

function elapsed(run: Run): string {
  if (!run.end_time) return "";
  const ms = run.end_time - run.start_time;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function resolveModelName(run: Run): string {
  return (run.extra?.invocation_params?.model as string) ?? run.name;
}

function parseToolInput(inputs: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!inputs) return {};
  const raw = inputs.input ?? inputs.url ?? inputs.query;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
    } catch {
      // not JSON, return as-is
    }
  }
  return inputs;
}

function truncateContent(raw: unknown): unknown {
  return typeof raw === "string" && raw.length > MAX_OUTPUT_LENGTH
    ? `${raw.slice(0, MAX_OUTPUT_LENGTH)}...(${raw.length} chars)`
    : raw;
}

function extractToolOutput(output: unknown): { status?: string; content?: unknown } {
  if (!output || typeof output !== "object") return { status: undefined, content: output };
  const o = output as Record<string, unknown>;
  // ToolMessage instance: has content and tool_call_id as direct fields
  if (typeof o.content !== "undefined" && typeof o.tool_call_id !== "undefined") {
    return { status: o.status as string | undefined, content: truncateContent(o.content) };
  }
  // Serialized LangChain envelope: { lc, type, kwargs: { content, status } }
  const kwargs = o.kwargs as Record<string, unknown> | undefined;
  if (kwargs && typeof kwargs === "object") {
    return { status: kwargs.status as string | undefined, content: truncateContent(kwargs.content) };
  }
  return { status: undefined, content: output };
}

export class PinoCallbackHandler extends BaseTracer {
  name = "pino_callback_handler";
  private baseLogger: pino.Logger;

  constructor(baseLogger: pino.Logger) {
    super();
    this.baseLogger = baseLogger;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected persistRun(_run: Run): Promise<void> {
    return Promise.resolve();
  }

  private resolveAgentName(run: Run): string {
    let current: Run | undefined = run;
    while (current?.parent_run_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runMap is deprecated but functional, used by ConsoleCallbackHandler
      const parent: Run | undefined = (this as any).runMap.get(current.parent_run_id);
      if (!parent) break;
      if (parent.name?.endsWith("-agent")) {
        return parent.name.replace(/-agent$/, "");
      }
      current = parent;
    }
    return "unknown";
  }

  onLLMStart(run: Run): void {
    const agent = this.resolveAgentName(run);
    const messages: unknown[] = run.inputs?.messages?.[0] ?? [];
    const imageCount = messages.filter((m: unknown) => {
      const content = (m as { kwargs?: { content?: unknown[] } })?.kwargs?.content;
      return Array.isArray(content) && content.some((c: unknown) => (c as { type?: string })?.type === "image");
    }).length;
    this.baseLogger.info({
      layer: "LangGraph::LLM",
      agent,
      event: "llm_start",
      model: resolveModelName(run),
      messageCount: messages.length,
      ...(imageCount > 0 && { imageCount }),
    });
  }

  onLLMEnd(run: Run): void {
    const agent = this.resolveAgentName(run);
    const tokenUsage = run.outputs?.llmOutput?.tokenUsage ?? run.outputs?.llmOutput?.usage ?? {};
    this.baseLogger.info({
      layer: "LangGraph::LLM",
      agent,
      event: "llm_end",
      model: resolveModelName(run),
      latency: elapsed(run),
      tokens: tokenUsage,
    });
  }

  onLLMError(run: Run): void {
    const agent = this.resolveAgentName(run);
    this.baseLogger.error({
      layer: "LangGraph::LLM",
      agent,
      event: "llm_error",
      model: resolveModelName(run),
      error: run.error,
    });
  }

  onToolStart(run: Run): void {
    const agent = this.resolveAgentName(run);
    this.baseLogger.info({
      layer: "LangGraph::Tool",
      agent,
      event: "tool_start",
      tool: run.name,
      input: parseToolInput(run.inputs),
    });
  }

  onToolEnd(run: Run): void {
    const agent = this.resolveAgentName(run);
    const { status, content } = extractToolOutput(run.outputs?.output);
    const input = parseToolInput(run.inputs);
    const url = input.url ?? input.query;
    this.baseLogger.info({
      layer: "LangGraph::Tool",
      agent,
      event: "tool_end",
      tool: run.name,
      ...(url ? { url } : {}),
      ...(status ? { status } : {}),
      content,
    });
  }

  onToolError(run: Run): void {
    const agent = this.resolveAgentName(run);
    this.baseLogger.error({
      layer: "LangGraph::Tool",
      agent,
      event: "tool_error",
      tool: run.name,
      error: run.error,
    });
  }

  onChainStart(): void {}
  onChainEnd(): void {}
  onChainError(): void {}
}
