import { createAgent, providerStrategy } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { IMAGE_ANALYSIS_PROMPT } from "../prompts/image-analysis";
import { type GraphState, type NodeConfig } from "../state";
import { fetchImages, type FetchedImage } from "../helpers/image-fetcher";

export const ImageAnalysisOutput = z.object({
  images: z.array(z.object({
    url: z.string(),
    keep: z.boolean(),
    reason: z.string(),
    identificationCues: z.string(),
    visualSummary: z.string(),
  })),
});

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
      ...images.map((img) => ({
        type: "image" as const,
        data: img.base64,
        mimeType: img.mediaType,
      })),
      {
        type: "text" as const,
        text: `Analyze these ${images.length} image(s) of a place. Filter each image and extract identification cues and a visual summary.`,
      },
    ],
  });
}

type ImageResult = z.infer<typeof ImageAnalysisOutput>["images"][number];

export const imageAnalysisNode = async (_state: GraphState, config: NodeConfig) => {
  const imageUrls: string[] = (config.configurable?.imageUrls as string[]) ?? [];

  if (imageUrls.length === 0) {
    return {
      visualSummary: "",
      identificationCues: "",
      filteredImageUrls: [],
    };
  }

  console.log(`  [image-analysis] analyzing ${imageUrls.length} image(s)...`);

  const { images: fetchedImages, errors: fetchErrors } = await fetchImages(imageUrls);

  if (fetchedImages.length === 0) {
    console.log("  [image-analysis] no images could be fetched");
    return {
      visualSummary: "",
      identificationCues: "",
      filteredImageUrls: [],
      errors: fetchErrors,
    };
  }

  const result = await imageAnalysisAgent.invoke({
    messages: [buildImageMessage(fetchedImages)],
  });

  const response = result.structuredResponse;
  const kept = response.images.filter((img: ImageResult) => img.keep);

  console.log(`  [image-analysis] kept ${kept.length}/${fetchedImages.length} images`);

  return {
    visualSummary: kept.map((img: ImageResult) => img.visualSummary).filter(Boolean).join("\n\n"),
    identificationCues: kept.map((img: ImageResult) => img.identificationCues).filter(Boolean).join("\n\n"),
    filteredImageUrls: kept.map((img: ImageResult) => img.url),
    errors: fetchErrors,
  };
};
