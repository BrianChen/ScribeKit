import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const mockLookup = mock.fn<(hostname: string) => Promise<{ address: string }>>();
mock.module("dns/promises", {
  exports: { lookup: mockLookup },
});

const { validateUrl } = await import("./url-validator.ts");

function assertBlocked(result: { safe: boolean; reason?: string }, expectedReason?: string) {
  assert.equal(result.safe, false, `Expected blocked but got safe`);
  if (expectedReason) {
    assert.equal(result.reason, expectedReason);
  }
}

function assertSafe(result: { safe: boolean; reason?: string }) {
  assert.equal(result.safe, true, `Expected safe but got blocked: ${result.reason}`);
}

beforeEach(() => {
  mockLookup.mock.resetCalls();
  mockLookup.mock.mockImplementation(async () => ({ address: "93.184.216.34" }));
});

describe("scheme validation", () => {
  it("allows https", async () => {
    assertSafe(await validateUrl("https://example.com"));
  });

  it("blocks http", async () => {
    assertBlocked(await validateUrl("http://example.com"), "Only HTTPS URLs are allowed");
  });

  it("blocks ftp", async () => {
    assertBlocked(await validateUrl("ftp://example.com"));
  });

  it("blocks file", async () => {
    assertBlocked(await validateUrl("file:///etc/passwd"));
  });

  it("blocks data", async () => {
    assertBlocked(await validateUrl("data:text/html,<h1>hi</h1>"));
  });

  it("blocks empty string", async () => {
    assertBlocked(await validateUrl(""));
  });

  it("blocks garbage", async () => {
    assertBlocked(await validateUrl("not-a-url"));
  });
});

describe("userinfo blocking", () => {
  it("blocks username", async () => {
    assertBlocked(
      await validateUrl("https://user@example.com"),
      "URLs with credentials are not allowed",
    );
  });

  it("blocks username and password", async () => {
    assertBlocked(
      await validateUrl("https://user:pass@example.com"),
      "URLs with credentials are not allowed",
    );
  });

  it("blocks SSRF trick — real host hidden after @", async () => {
    assertBlocked(
      await validateUrl("https://google.com:secret@127.0.0.1/admin"),
      "URLs with credentials are not allowed",
    );
  });
});

describe("IPv4 private IP literals", () => {
  it("blocks loopback 127.0.0.1", async () => {
    assertBlocked(await validateUrl("https://127.0.0.1"), "Private/internal IP");
  });

  it("blocks loopback 127.255.255.255", async () => {
    assertBlocked(await validateUrl("https://127.255.255.255"), "Private/internal IP");
  });

  it("blocks 10.x (RFC 1918)", async () => {
    assertBlocked(await validateUrl("https://10.0.0.1"), "Private/internal IP");
  });

  it("blocks 172.16.x (RFC 1918)", async () => {
    assertBlocked(await validateUrl("https://172.16.0.1"), "Private/internal IP");
  });

  it("blocks 172.31.x (RFC 1918 upper bound)", async () => {
    assertBlocked(await validateUrl("https://172.31.255.255"), "Private/internal IP");
  });

  it("allows 172.15.255.255 (just below /12)", async () => {
    assertSafe(await validateUrl("https://172.15.255.255"));
  });

  it("allows 172.32.0.0 (just above /12)", async () => {
    assertSafe(await validateUrl("https://172.32.0.0"));
  });

  it("blocks 192.168.x (RFC 1918)", async () => {
    assertBlocked(await validateUrl("https://192.168.1.1"), "Private/internal IP");
  });

  it("blocks 0.0.0.0", async () => {
    assertBlocked(await validateUrl("https://0.0.0.0"), "Private/internal IP");
  });

  it("blocks 169.254.x (link-local)", async () => {
    assertBlocked(await validateUrl("https://169.254.1.1"), "Private/internal IP");
  });

  it("blocks 100.64.x (CGNAT)", async () => {
    assertBlocked(await validateUrl("https://100.64.0.1"), "Private/internal IP");
  });

  it("blocks 198.18.x (benchmarking)", async () => {
    assertBlocked(await validateUrl("https://198.18.0.1"), "Private/internal IP");
  });

  it("blocks 198.19.x (benchmarking)", async () => {
    assertBlocked(await validateUrl("https://198.19.255.255"), "Private/internal IP");
  });

  it("allows 198.20.0.0 (just above benchmarking /15)", async () => {
    assertSafe(await validateUrl("https://198.20.0.0"));
  });

  it("blocks 192.0.2.x (TEST-NET-1)", async () => {
    assertBlocked(await validateUrl("https://192.0.2.1"), "Private/internal IP");
  });

  it("blocks 198.51.100.x (TEST-NET-2)", async () => {
    assertBlocked(await validateUrl("https://198.51.100.1"), "Private/internal IP");
  });

  it("blocks 203.0.113.x (TEST-NET-3)", async () => {
    assertBlocked(await validateUrl("https://203.0.113.1"), "Private/internal IP");
  });

  it("allows public IP 8.8.8.8", async () => {
    assertSafe(await validateUrl("https://8.8.8.8"));
  });

  it("allows public IP 1.1.1.1", async () => {
    assertSafe(await validateUrl("https://1.1.1.1"));
  });
});

describe("IPv4 cloud metadata IPs", () => {
  it("blocks AWS/GCP/Azure metadata 169.254.169.254", async () => {
    assertBlocked(await validateUrl("https://169.254.169.254"), "Cloud metadata IP");
  });

  it("blocks AWS ECS metadata 169.254.170.2", async () => {
    assertBlocked(await validateUrl("https://169.254.170.2"), "Cloud metadata IP");
  });

  it("blocks Alibaba metadata 100.100.100.200", async () => {
    assertBlocked(await validateUrl("https://100.100.100.200"), "Cloud metadata IP");
  });
});

describe("IPv6 private IP literals", () => {
  it("blocks loopback ::1", async () => {
    assertBlocked(await validateUrl("https://[::1]"), "Private/internal IP");
  });

  it("blocks unspecified ::", async () => {
    assertBlocked(await validateUrl("https://[::]"), "Private/internal IP");
  });

  it("blocks unique local fc00::", async () => {
    assertBlocked(await validateUrl("https://[fc00::1]"), "Private/internal IP");
  });

  it("blocks unique local fd00::", async () => {
    assertBlocked(await validateUrl("https://[fd12::1]"), "Private/internal IP");
  });

  it("blocks link-local fe80::", async () => {
    assertBlocked(await validateUrl("https://[fe80::1]"), "Private/internal IP");
  });

  it("blocks multicast ff00::", async () => {
    assertBlocked(await validateUrl("https://[ff00::1]"), "Private/internal IP");
  });

  it("blocks multicast ff02::1", async () => {
    assertBlocked(await validateUrl("https://[ff02::1]"), "Private/internal IP");
  });
});

describe("IPv4-mapped IPv6", () => {
  it("blocks ::ffff:127.0.0.1", async () => {
    assertBlocked(await validateUrl("https://[::ffff:127.0.0.1]"), "Private/internal IP");
  });

  it("blocks ::ffff:10.0.0.1", async () => {
    assertBlocked(await validateUrl("https://[::ffff:10.0.0.1]"), "Private/internal IP");
  });

  it("blocks ::ffff:169.254.169.254 as cloud metadata", async () => {
    assertBlocked(await validateUrl("https://[::ffff:169.254.169.254]"), "Cloud metadata IP");
  });
});

describe("blocked hostnames", () => {
  it("blocks localhost", async () => {
    assertBlocked(await validateUrl("https://localhost"), "Blocked hostname");
  });

  it("blocks localhost.localdomain", async () => {
    assertBlocked(await validateUrl("https://localhost.localdomain"), "Blocked hostname");
  });

  it("blocks metadata.google.internal", async () => {
    assertBlocked(await validateUrl("https://metadata.google.internal"), "Blocked hostname");
  });

  it("blocks metadata", async () => {
    assertBlocked(await validateUrl("https://metadata"), "Blocked hostname");
  });

  it("blocks instance-data", async () => {
    assertBlocked(await validateUrl("https://instance-data"), "Blocked hostname");
  });

  it("blocks case-insensitive LOCALHOST", async () => {
    assertBlocked(await validateUrl("https://LOCALHOST"), "Blocked hostname");
  });

  it("blocks case-insensitive Metadata.Google.Internal", async () => {
    assertBlocked(await validateUrl("https://Metadata.Google.Internal"), "Blocked hostname");
  });
});

describe("blocked TLDs", () => {
  it("blocks .localhost TLD", async () => {
    assertBlocked(await validateUrl("https://evil.localhost"), "Blocked hostname");
  });

  it("blocks .local TLD", async () => {
    assertBlocked(await validateUrl("https://printer.local"), "Blocked hostname");
  });

  it("blocks nested .localhost", async () => {
    assertBlocked(await validateUrl("https://a.b.localhost"), "Blocked hostname");
  });
});

describe("DNS resolution", () => {
  it("blocks hostname resolving to private IP", async () => {
    mockLookup.mock.mockImplementation(async () => ({ address: "10.0.0.1" }));
    assertBlocked(
      await validateUrl("https://evil.com"),
      "URL resolves to a private/internal IP",
    );
  });

  it("blocks hostname resolving to loopback", async () => {
    mockLookup.mock.mockImplementation(async () => ({ address: "127.0.0.1" }));
    assertBlocked(
      await validateUrl("https://evil.com"),
      "URL resolves to a private/internal IP",
    );
  });

  it("blocks hostname resolving to cloud metadata IP", async () => {
    mockLookup.mock.mockImplementation(async () => ({ address: "169.254.169.254" }));
    assertBlocked(
      await validateUrl("https://evil.com"),
      "URL resolves to cloud metadata IP",
    );
  });

  it("blocks hostname resolving to IPv4-mapped IPv6 private", async () => {
    mockLookup.mock.mockImplementation(async () => ({ address: "::ffff:127.0.0.1" }));
    assertBlocked(
      await validateUrl("https://evil.com"),
      "URL resolves to a private/internal IP",
    );
  });

  it("allows hostname resolving to public IP", async () => {
    mockLookup.mock.mockImplementation(async () => ({ address: "93.184.216.34" }));
    assertSafe(await validateUrl("https://example.com"));
  });

  it("blocks on DNS failure", async () => {
    mockLookup.mock.mockImplementation(async () => { throw new Error("ENOTFOUND"); });
    assertBlocked(await validateUrl("https://nonexistent.invalid"), "Invalid URL");
  });
});

describe("valid URLs", () => {
  it("allows normal https URL", async () => {
    assertSafe(await validateUrl("https://example.com"));
  });

  it("allows https URL with path", async () => {
    assertSafe(await validateUrl("https://example.com/path/to/page"));
  });

  it("allows https URL with query string", async () => {
    assertSafe(await validateUrl("https://example.com/search?q=test"));
  });

  it("allows public IPv4 literal", async () => {
    assertSafe(await validateUrl("https://8.8.8.8"));
  });

  it("allows TripAdvisor homepage", async () => {
    assertSafe(await validateUrl("https://www.tripadvisor.com/"));
  });

  it("allows TripAdvisor attractions page with path", async () => {
    assertSafe(await validateUrl("https://www.tripadvisor.com/Attractions-g60713-Activities-San_Francisco_California.html"));
  });

  it("allows Lonely Planet point of interest", async () => {
    assertSafe(await validateUrl("https://www.lonelyplanet.com/points-of-interest/vatnajoekull-national-park/1591191"));
  });
});
