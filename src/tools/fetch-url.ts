import { tool } from "langchain";
import { z } from "zod";
import { load } from "cheerio";
import { validateUrl } from "../helpers/url-validator";

const MAX_RESPONSE_SIZE = 50_000;
const MAX_RAW_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 10_000;

async function readCapped(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    chunks.push(decoder.decode(value, { stream: true }));
    if (bytes >= MAX_RAW_BYTES) break;
  }

  reader.cancel();
  return chunks.join("");
}

const fetchUrl = tool(
  async ({ url }) => {
    const validation = await validateUrl(url);
    if (!validation.safe) {
      return `Error: ${validation.reason}`;
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          "User-Agent": "ScribeKit/1.0",
        },
      });

      if (!response.ok) {
        return `Error: HTTP ${response.status}`;
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("text/")) {
        return "Error: Response is not a text content type";
      }

      const html = await readCapped(response);
      const $ = load(html);
      $("script, style, nav, footer, header, noscript, aside, form, iframe, svg").remove();
      $("*").contents().filter(function () { return this.type === "comment"; }).remove();
      const text = $("body").text().replace(/\s+/g, " ").trim();

      return text.slice(0, MAX_RESPONSE_SIZE);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : "Fetch failed"}`;
    }
  },
  {
    name: "fetch_url",
    description: "Fetch a URL and return its text content",
    schema: z.object({ url: z.string().url() }),
  }
);

export default fetchUrl;
