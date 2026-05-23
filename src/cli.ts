#!/usr/bin/env node
//
// Usage:
//   npm run dev -- generate --input examples/cli-input.json --output result.json
//   npm run dev -- generate -i examples/cli-input.json
//
// Input JSON fields:
//   placeName        (required) — name of the place
//   destinationName  (required) — city or destination name
//   country          (required) — country name
//   address          (optional) — street address hint
//   imageUrls        (optional) — array of image URLs, max 5
//   notes            (optional) — freeform notes
//
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import { generate } from "./index";
import { PASSING_CONFIDENCE, type ConfidenceLevel } from "./context";

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
      console.error("Input JSON must include placeName and destinationName.");
      process.exit(1);
    }

    if (input.imageUrls && input.imageUrls.length > 5) {
      console.error("Maximum 5 image URLs allowed.");
      process.exit(1);
    }

    console.log(`Generating content for: ${input.placeName} (${input.destinationName})...`);
    if (input.imageUrls?.length) {
      console.log(`  Processing ${input.imageUrls.length} image(s)...`);
    }
    console.log();

    const result = await generate(input);

    if (result.errors.length > 0) {
      console.error(`\nErrors: ${result.errors.join("\n")}`);
    }

    if (!PASSING_CONFIDENCE.has(result.confidence as ConfidenceLevel)) {
      console.error(`\nPlace could not be confirmed (confidence: ${result.confidence}). Pipeline stopped.`);
    }

    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nOutput written to ${outputPath}`);
  });

program.parse();
