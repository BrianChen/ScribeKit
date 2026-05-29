import type pino from "pino";
import { BaseTracer, type Run } from "@langchain/core/tracers/base";

const MAX_OUTPUT_LENGTH = 500;

function truncateOutput(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_OUTPUT_LENGTH) {
    return `${value.slice(0, MAX_OUTPUT_LENGTH)}...(${value.length} chars)`;
  }
  return value;
}

function elapsed(run: Run): string {
  if (!run.end_time) return "";
  const ms = run.end_time - run.start_time;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
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
    this.baseLogger.info({
      layer: "LangGraph::LLM",
      agent,
      event: "llm_start",
      model: run.name,
      messages: run.inputs,
    });
  }

  onLLMEnd(run: Run): void {
    const agent = this.resolveAgentName(run);
    const tokenUsage = run.outputs?.llmOutput?.tokenUsage ?? run.outputs?.llmOutput?.usage ?? {};
    this.baseLogger.info({
      layer: "LangGraph::LLM",
      agent,
      event: "llm_end",
      model: run.name,
      latency: elapsed(run),
      tokens: tokenUsage,
      response: truncateOutput(
        run.outputs?.generations?.[0]?.[0]?.text ??
        run.outputs?.generations?.[0]?.[0]?.message?.content ??
        "",
      ),
    });
  }

  onLLMError(run: Run): void {
    const agent = this.resolveAgentName(run);
    this.baseLogger.error({
      layer: "LangGraph::LLM",
      agent,
      event: "llm_error",
      model: run.name,
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
      input: run.inputs,
    });
  }

  onToolEnd(run: Run): void {
    const agent = this.resolveAgentName(run);
    this.baseLogger.info({
      layer: "LangGraph::Tool",
      agent,
      event: "tool_end",
      tool: run.name,
      output: truncateOutput(run.outputs?.output),
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
