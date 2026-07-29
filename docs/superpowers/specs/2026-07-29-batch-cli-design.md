# Batch CLI Design

## Overview

Update the ScribeKit CLI to accept multiple places in a single input file and process them in parallel, writing all successful results to a single output file.

## Input Format

The input file is always an array of place objects. Each entry follows the existing `GenerateInput` schema.

```json
[
  { "placeName": "Times Square", "destinationName": "New York City", "country": "United States" },
  { "placeName": "The Edge", "destinationName": "New York City", "country": "United States" }
]
```

Single-place workflows migrate by wrapping the existing object in `[]`. The `run:pipeline` script in `package.json` requires no changes.

## Execution

All places run in parallel via `Promise.allSettled()`. Each place is an independent `generate()` call. A failure in one place does not affect others.

## Output Format

`result.json` contains an array of `GenerateResult` objects — successful results only, in the same order as the input (gaps from failed places are removed). Failed places (those that threw `ScribeKitError`) are silently dropped from the output.

LOW/NONE confidence results resolve normally as `GenerateResult` objects with `ok: false` and are included in the output.

## CLI Changes

- Parse input as an array of place objects
- Validate each entry (must have `placeName` and `destinationName`; max 5 `imageUrls`)
- Run all via `Promise.allSettled()`
- Filter out rejected promises
- Write the array of successful results to the output file
- Log a summary: total places, succeeded, failed

## Files Changed

- `src/cli.ts` — batch input/output logic
- `workspace/cli-input.json` — wrap existing place in `[]`
