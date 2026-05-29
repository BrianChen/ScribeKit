#!/usr/bin/env node
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import { generate } from "./index";
import { PASSING_CONFIDENCE, type ConfidenceLevel } from "./context";
import { logger } from "./logger";

const cliLog = logger.child({ layer: "App::CLI", agent: "" });

const program = new Command();

program
  .name("scribekit")
  .description("AI-powered multi-agent content generation toolkit")
  .version("0.1.0");

program
  .command("generate")
  .description("Generate editorial content for a place")
  .requiredOption("-i, --input <path>", "Path to input JSON file")
  .option("-o, --output <path>", "Path to output JSON file", "output.json")
  .action(async (opts) => {
    const inputPath = resolve(opts.input);
    const outputPath = resolve(opts.output);

    const input = JSON.parse(readFileSync(inputPath, "utf-8"));

    if (!input.placeName || !input.destinationName) {
      cliLog.error({ event: "failed", errors: ["Input JSON must include placeName and destinationName."] });
      process.exit(1);
    }

    if (input.imageUrls && input.imageUrls.length > 5) {
      cliLog.error({ event: "failed", errors: ["Maximum 5 image URLs allowed."] });
      process.exit(1);
    }

    cliLog.info({
      event: "input_loaded",
      placeName: input.placeName,
      destinationName: input.destinationName,
      country: input.country,
      imageCount: input.imageUrls?.length ?? 0,
      imageUrls: input.imageUrls,
      notes: input.notes ?? null,
    });

    const result = await generate(input);

    if (result.errors.length > 0) {
      cliLog.warn({ event: "failed", errors: result.errors });
    }

    if (!PASSING_CONFIDENCE.has(result.confidence as ConfidenceLevel)) {
      cliLog.error({
        event: "failed",
        errors: [`Place could not be confirmed (confidence: ${result.confidence}). Pipeline stopped.`],
      });
    }

    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    cliLog.info({ event: "output_written", path: outputPath });
  });

program.parse();
