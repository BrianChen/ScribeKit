# ScribeKit

AI-powered multi-agent content generation toolkit.

ScribeKit uses a multi-agent pipeline (research → editorial) to generate structured, fact-grounded content. The research agent browses the web to gather real information, then the editorial agent writes polished content conforming to a strict output schema.

## Quick Start

```bash
npm install
```

Create a `.env` file with your API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

### CLI

```bash
# Generate content for a place
npx tsx src/cli.ts generate --input examples/the-edge.json --output result.json
```

### Library

```ts
import { generate } from "scribekit";

const result = await generate({
  placeName: "The Edge",
  destinationName: "New York",
  country: "United States",
  address: "30 Hudson Yards, New York, NY 10001, USA",
  latitude: 40.7534,
  longitude: -74.0011,
});

console.log(result.editorialContent);
```

## Architecture

```
Input JSON → Research Agent (Claude Haiku) → Editorial Agent (Claude Sonnet) → Output JSON
```

- **Research Agent** — browses the web with the `fetch_url` tool, gathers factual information
- **Editorial Agent** — writes structured editorial content based on research notes

Built on [LangGraph](https://github.com/langchain-ai/langgraphjs) for agent orchestration.

## Testing

```bash
npm test
```

## Project Structure

```
src/
  index.ts              # Library entry — generate() function
  cli.ts                # CLI entry point
  context.ts            # Input schema (Zod)
  graph.ts              # LangGraph workflow
  agents/
    research-agent.ts   # Web research agent
    editorial-agent.ts  # Editorial writing agent
  prompts/
    research.ts         # Research agent system prompt
    editorial.ts        # Editorial agent system prompt
  tools/
    fetch-url.ts        # URL fetching with HTML parsing
  helpers/
    url-validator.ts    # SSRF-safe URL validation
examples/
  the-edge.json         # Example input
```

## License

MIT
