#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import { generate } from "./index";

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

    console.log(`Generating content for: ${input.placeName} (${input.destinationName})...\n`);

    const result = await generate(input);

    if (result.errors.length > 0) {
      console.error(`\nErrors: ${result.errors.join("\n")}`);
    }

    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nOutput written to ${outputPath}`);
  });

program.parse();
