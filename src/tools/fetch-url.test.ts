import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fetchUrl from './fetch-url';

const mockValidateUrl = mock.fn();
mock.module("../helpers/url-validator", {
  exports: { validateUrl: mockValidateUrl },
});

mock.module("langchain", {
  exports: { tool: (fn: Function) => fn },
});

const originalFetch = globalThis.fetch;

function makeResponse(body: string, opts: { status?: number; contentType?: string } = {}): Response {
  return new Response(body, {
    status: opts.status ?? 200,
    headers: { "content-type": opts.contentType ?? "text/html" },
  });
}

beforeEach(() => {
  mockValidateUrl.mock.resetCalls();
  mockValidateUrl.mock.mockImplementation(async () => ({ safe: true }));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("URL validation", () => {
  it("returns error when URL is unsafe", async () => {
    mockValidateUrl.mock.mockImplementation(async () => ({ safe: false, reason: "Blocked hostname" }));
    const result = await fetchUrl({ url: "https://localhost" });
    assert.equal(result, "Error: Blocked hostname");
  });

  it("does not call fetch when URL is unsafe", async () => {
    mockValidateUrl.mock.mockImplementation(async () => ({ safe: false, reason: "Private/internal IP" }));
    const mockFetch = mock.fn();
    globalThis.fetch = mockFetch;
    await fetchUrl({ url: "https://127.0.0.1" });
    assert.equal(mockFetch.mock.callCount(), 0);
  });
});

describe("HTTP status codes", () => {
  it("returns error for 404", async () => {
    globalThis.fetch = mock.fn(async () => makeResponse("Not Found", { status: 404 }));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "Error: HTTP 404");
  });

  it("returns error for 500", async () => {
    globalThis.fetch = mock.fn(async () => makeResponse("Server Error", { status: 500 }));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "Error: HTTP 500");
  });

  it("returns error for 403", async () => {
    globalThis.fetch = mock.fn(async () => makeResponse("Forbidden", { status: 403 }));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "Error: HTTP 403");
  });
});

describe("content-type check", () => {
  it("rejects application/json", async () => {
    globalThis.fetch = mock.fn(async () => makeResponse("{}", { contentType: "application/json" }));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "Error: Response is not a text content type");
  });

  it("rejects image/png", async () => {
    globalThis.fetch = mock.fn(async () => makeResponse("binary", { contentType: "image/png" }));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "Error: Response is not a text content type");
  });

  it("accepts TEXT/HTML case-insensitive", async () => {
    globalThis.fetch = mock.fn(async () => makeResponse("<p>hello</p>", { contentType: "TEXT/HTML" }));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "hello");
  });

  it("accepts text/html with charset", async () => {
    globalThis.fetch = mock.fn(async () => makeResponse("<p>hello</p>", { contentType: "text/html; charset=utf-8" }));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "hello");
  });
});

describe("HTML stripping", () => {
  it("removes script tags", async () => {
    globalThis.fetch = mock.fn(async () => makeResponse("<p>hello</p><script>alert('xss')</script>"));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "hello");
  });

  it("removes style tags", async () => {
    globalThis.fetch = mock.fn(async () => makeResponse("<style>.x{color:red}</style><p>hello</p>"));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "hello");
  });

  it("removes nav, footer, header, aside", async () => {
    const html = "<nav>Menu</nav><header>Top</header><main><p>content</p></main><aside>Sidebar</aside><footer>Bottom</footer>";
    globalThis.fetch = mock.fn(async () => makeResponse(html));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "content");
  });

  it("removes iframe, svg, form, noscript", async () => {
    const html = "<p>text</p><iframe src='x'></iframe><svg></svg><form><input></form><noscript>no js</noscript>";
    globalThis.fetch = mock.fn(async () => makeResponse(html));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "text");
  });

  it("removes HTML comments", async () => {
    globalThis.fetch = mock.fn(async () => makeResponse("<!-- secret comment --><p>visible</p>"));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "visible");
  });

  it("strips all tags from output", async () => {
    globalThis.fetch = mock.fn(async () => makeResponse("<div><p>Built in <strong>1889</strong></p></div>"));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "Built in 1889");
  });

  it("collapses whitespace", async () => {
    globalThis.fetch = mock.fn(async () => makeResponse("<p>hello    \n\n   world</p>"));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "hello world");
  });
});

describe("output truncation", () => {
  it("caps output at 50k chars", async () => {
    const longText = "a".repeat(60_000);
    globalThis.fetch = mock.fn(async () => makeResponse(`<p>${longText}</p>`));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result.length, 50_000);
  });
});

describe("raw body size limit", () => {
  it("stops reading at 1MB", async () => {
    const huge = "x".repeat(2_000_000);
    globalThis.fetch = mock.fn(async () => makeResponse(`<p>${huge}</p>`));
    const result = await fetchUrl({ url: "https://example.com" });
    assert.ok(result.length <= 50_000);
    assert.ok(result.length > 0);
  });
});

describe("error handling", () => {
  it("catches network errors", async () => {
    globalThis.fetch = mock.fn(async () => { throw new Error("ECONNREFUSED"); });
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "Error: ECONNREFUSED");
  });

  it("catches redirect errors", async () => {
    globalThis.fetch = mock.fn(async () => { throw new TypeError("redirect mode is set to error"); });
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "Error: redirect mode is set to error");
  });

  it("catches timeout errors", async () => {
    globalThis.fetch = mock.fn(async () => { throw new DOMException("The operation was aborted", "AbortError"); });
    const result = await fetchUrl({ url: "https://example.com" });
    assert.equal(result, "Error: The operation was aborted");
  });
});

describe("fetch options", () => {
  it("passes correct options", async () => {
    const mockFetch = mock.fn(async () => makeResponse("<p>hi</p>"));
    globalThis.fetch = mockFetch;
    await fetchUrl({ url: "https://example.com/path" });

    const [url, options] = mockFetch.mock.calls[0].arguments;
    assert.equal(url, "https://example.com/path");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(options.headers["User-Agent"], "ScribeKit/1.0");
  });
});
