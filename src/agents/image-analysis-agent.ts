import { createAgent, providerStrategy } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { IMAGE_ANALYSIS_PROMPT } from "../prompts/image-analysis";
import { type GraphState, type NodeConfig } from "../state";
import { fetchImages, type FetchedImage } from "../helpers/image-fetcher";
import { createNodeLogger } from "../logger";

export const ImageAnalysisOutput = z.object({
  images: z.array(z.object({
    url: z.string(),
    keep: z.boolean(),
    reason: z.string(),
  }).strict()),
  visualSummary: z.string(),
}).strict();

const imageAnalysisAgent = createAgent({
  model: new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 2048,
    maxRetries: 2,
  }),
  systemPrompt: IMAGE_ANALYSIS_PROMPT,
  responseFormat: providerStrategy(ImageAnalysisOutput),
});

function buildImageMessage(images: FetchedImage[]): HumanMessage {
  return new HumanMessage({
    content: [
      ...images.flatMap((img) => [
        { type: "text" as const, text: `Image URL: ${img.url}` },
        { type: "image" as const, data: img.base64, mimeType: img.mediaType },
      ]),
      {
        type: "text" as const,
        text: `Analyze these ${images.length} image(s) of a place. Each image has an associated URL label — use that exact URL as the url field in your response. Do not fetch or access the URL, it is for identification purposes in your response only. Filter each image, then write a combined visual summary of all kept images.`,
      },
    ],
  });
}

export const imageAnalysisNode = async (_state: GraphState, config: NodeConfig) => {
  const lgLog = createNodeLogger("LangGraph::Node", "image-analysis");
  const appLog = createNodeLogger("App::Node", "image-analysis");
  const imageUrls: string[] = (config.configurable?.imageUrls as string[]) ?? [];

  lgLog.info({ event: "node_start" });

  if (imageUrls.length === 0) {
    const stateUpdate = { visualSummary: "", filteredImageUrls: [] };
    lgLog.info({ event: "state_update", ...stateUpdate });
    lgLog.info({ event: "node_end" });
    return stateUpdate;
  }

  const startTime = Date.now();
  const fetchResults = await fetchImages(imageUrls);

  for (const r of fetchResults) {
    if (r.status === "success") {
      appLog.info({ event: "image_fetch", url: r.url, status: r.status, mediaType: r.mediaType, bytes: r.bytes });
    } else {
      appLog.warn({ event: "image_fetch", url: r.url, status: r.status, reason: r.reason });
    }
  }

  const fetchedImages = fetchResults.filter((r) => r.status === "success" && r.image).map((r) => r.image!);
  const fetchErrors = fetchResults.filter((r) => r.status === "error").map((r) => `${r.url}: ${r.reason}`);

  if (fetchedImages.length === 0) {
    const stateUpdate = { visualSummary: "", filteredImageUrls: [] as string[], errors: fetchErrors };
    lgLog.info({ event: "state_update", ...stateUpdate });
    lgLog.info({ event: "node_end", duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` });
    return stateUpdate;
  }

  const result = await imageAnalysisAgent.invoke({
    messages: [buildImageMessage(fetchedImages)],
  });

  const response = result.structuredResponse;
  const kept = response.images.filter((img) => img.keep);

  for (const img of response.images) {
    appLog.info({ event: "image_filter", url: img.url, keep: img.keep, reason: img.reason });
  }

  const stateUpdate = {
    visualSummary: response.visualSummary,
    filteredImageUrls: kept.map((img) => img.url),
    errors: fetchErrors,
  };

  lgLog.info({ event: "state_update", ...stateUpdate });
  lgLog.info({ event: "node_end", duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` });

  return stateUpdate;
};
