import { lookup } from "dns/promises";

const IP4_PRIVATE_CIDRS = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "127.0.0.0/8",
  "0.0.0.0/8",
  "169.254.0.0/16",
  "100.64.0.0/10",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "198.18.0.0/15",
];

const IP6_PRIVATE_CIDRS = [
  "::1/128",
  "::/128",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
];

const IP4_CLOUD_METADATA = new Set([
  "169.254.169.254",
  "169.254.170.2",
  "100.100.100.200",
]);

const CLOUD_METADATA_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

const LOCALHOST_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const BLOCKED_TLDS = [".localhost", ".local"];

const ALL_BLOCKED_HOSTNAMES = new Set([
  ...LOCALHOST_HOSTNAMES,
  ...CLOUD_METADATA_HOSTNAMES,
]);

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIp4(ip: string): number | null {
  const m = IPV4_RE.exec(ip);
  if (!m) return null;
  const a = +m[1], b = +m[2], c = +m[3], d = +m[4];
  if (a > 255 || b > 255 || c > 255 || d > 255) return null;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function inIp4Cidr(ip: number, cidr: string): boolean {
  const [netStr, prefixStr] = cidr.split("/");
  const net = parseIp4(netStr);
  if (net === null) return false;
  const bits = +prefixStr;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (net & mask);
}

function parseIp6(ip: string): number[] | null {
  if (!ip || !ip.includes(":")) return null;

  let normalized = ip;

  const lastColon = ip.lastIndexOf(":");
  const tail = ip.slice(lastColon + 1);
  const v4 = parseIp4(tail);
  if (v4 !== null) {
    const hi = (v4 >>> 16).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    normalized = ip.slice(0, lastColon + 1) + hi + ":" + lo;
  }

  if (!/^[0-9a-fA-F:]+$/.test(normalized)) return null;

  let parts: string[];
  if (normalized.includes("::")) {
    const halves = normalized.split("::");
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves[1] ? halves[1].split(":") : [];
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    parts = [...left, ...Array(fill).fill("0"), ...right];
  } else {
    parts = normalized.split(":");
  }

  if (parts.length !== 8) return null;
  const groups: number[] = [];
  for (const p of parts) {
    if (p.length === 0 || p.length > 4) return null;
    groups.push(parseInt(p, 16));
  }
  return groups;
}

function inIp6Cidr(ip: number[], cidr: string): boolean {
  const [netStr, prefixStr] = cidr.split("/");
  const net = parseIp6(netStr);
  if (!net) return false;
  let remaining = +prefixStr;
  for (let i = 0; i < 8 && remaining > 0; i++) {
    const bits = Math.min(16, remaining);
    const mask = (0xffff << (16 - bits)) & 0xffff;
    if ((ip[i] & mask) !== (net[i] & mask)) return false;
    remaining -= bits;
  }
  return true;
}

function extractMappedIp4(groups: number[]): number | null {
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 &&
      groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    return ((groups[6] << 16) | groups[7]) >>> 0;
  }
  return null;
}

function isPrivateIp(address: string): boolean {
  const ip4 = parseIp4(address);
  if (ip4 !== null) {
    return IP4_PRIVATE_CIDRS.some(c => inIp4Cidr(ip4, c));
  }

  const ip6 = parseIp6(address);
  if (ip6) {
    const mapped = extractMappedIp4(ip6);
    if (mapped !== null) {
      return IP4_PRIVATE_CIDRS.some(c => inIp4Cidr(mapped, c));
    }
    return IP6_PRIVATE_CIDRS.some(c => inIp6Cidr(ip6, c));
  }

  return false;
}

function isCloudMetadataIp(address: string): boolean {
  if (IP4_CLOUD_METADATA.has(address)) return true;

  const ip6 = parseIp6(address);
  if (ip6) {
    const mapped = extractMappedIp4(ip6);
    if (mapped !== null) {
      const a = (mapped >>> 24) & 0xff, b = (mapped >>> 16) & 0xff;
      const c = (mapped >>> 8) & 0xff, d = mapped & 0xff;
      return IP4_CLOUD_METADATA.has(`${a}.${b}.${c}.${d}`);
    }
  }

  return false;
}

function isIpLiteral(hostname: string): boolean {
  return parseIp4(hostname) !== null || parseIp6(hostname) !== null;
}

export async function validateUrl(url: string): Promise<{ safe: boolean; reason?: string }> {
  try {
    if (!url.startsWith("https://")) {
      return { safe: false, reason: "Only HTTPS URLs are allowed" };
    }

    const parsed = new URL(url);

    if (parsed.username || parsed.password) {
      return { safe: false, reason: "URLs with credentials are not allowed" };
    }

    const raw = parsed.hostname;
    const hostname = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;

    if (isIpLiteral(hostname)) {
      if (isCloudMetadataIp(hostname)) {
        return { safe: false, reason: "Cloud metadata IP" };
      }
      if (isPrivateIp(hostname)) {
        return { safe: false, reason: "Private/internal IP" };
      }
      return { safe: true };
    }

    const lower = hostname.toLowerCase();
    if (ALL_BLOCKED_HOSTNAMES.has(lower) || BLOCKED_TLDS.some(tld => lower.endsWith(tld))) {
      return { safe: false, reason: "Blocked hostname" };
    }

    const { address } = await lookup(hostname);

    if (isCloudMetadataIp(address)) {
      return { safe: false, reason: "URL resolves to cloud metadata IP" };
    }

    if (isPrivateIp(address)) {
      return { safe: false, reason: "URL resolves to a private/internal IP" };
    }

    return { safe: true };
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }
}
