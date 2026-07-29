#!/usr/bin/env node
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import { generate, type GenerateInput, type GenerateResult } from "./index";
import { PASSING_CONFIDENCE, type ConfidenceLevel } from "./context";
import { logger } from "./logger";

const cliLog = logger.child({ layer: "App::CLI", agent: "" });

export function validatePlaces(places: unknown[]): string[] {
  const errors: string[] = [];
  places.forEach((place, i) => {
    const p = place as Record<string, unknown>;
    if (!p.placeName || !p.destinationName) {
      errors.push(`Place ${i}: must include placeName and destinationName.`);
    }
    if (Array.isArray(p.imageUrls) && p.imageUrls.length > 5) {
      errors.push(`Place ${i} (${String(p.placeName)}): maximum 5 image URLs allowed.`);
    }
  });
  return errors;
}

const program = new Command();

program
  .name("scribekit")
  .description("AI-powered multi-agent content generation toolkit")
  .version("0.1.0");

program
  .command("generate")
  .description("Generate editorial content for one or more places")
  .requiredOption("-i, --input <path>", "Path to input JSON file (array of places)")
  .option("-o, --output <path>", "Path to output JSON file", "output.json")
  .action(async (opts) => {
    const inputPath = resolve(opts.input);
    const outputPath = resolve(opts.output);

    const raw = JSON.parse(readFileSync(inputPath, "utf-8"));

    if (!Array.isArray(raw)) {
      cliLog.error({ event: "failed", errors: ["Input JSON must be an array of places."] });
      process.exit(1);
    }

    const validationErrors = validatePlaces(raw);
    if (validationErrors.length > 0) {
      cliLog.error({ event: "failed", errors: validationErrors });
      process.exit(1);
    }

    const places = raw as GenerateInput[];

    cliLog.info({
      event: "input_loaded",
      count: places.length,
      places: places.map((p) => ({
        placeName: p.placeName,
        destinationName: p.destinationName,
        country: p.country,
        imageCount: p.imageUrls?.length ?? 0,
      })),
    });

    const settlements = await Promise.allSettled(places.map((place) => generate(place)));

    const results: GenerateResult[] = [];
    let succeeded = 0;
    let failed = 0;

    settlements.forEach((settlement, i) => {
      if (settlement.status === "fulfilled") {
        const result = settlement.value;
        results.push(result);
        succeeded++;
        if (result.errors.length > 0) {
          cliLog.warn({ event: "place_warnings", placeName: places[i].placeName, errors: result.errors });
        }
        if (!PASSING_CONFIDENCE.has(result.confidence as ConfidenceLevel)) {
          cliLog.warn({
            event: "place_low_confidence",
            placeName: places[i].placeName,
            confidence: result.confidence,
          });
        }
      } else {
        failed++;
        cliLog.error({
          event: "place_failed",
          placeName: places[i].placeName,
          error: settlement.reason instanceof Error ? settlement.reason.message : String(settlement.reason),
        });
      }
    });

    writeFileSync(outputPath, JSON.stringify(results, null, 2));
    cliLog.info({ event: "output_written", path: outputPath, total: places.length, succeeded, failed });
  });

import { fileURLToPath } from "url";
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  program.parse();
}
