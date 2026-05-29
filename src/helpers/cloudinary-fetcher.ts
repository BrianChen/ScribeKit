import sharp from "sharp";
import { v2 as cloudinary } from "cloudinary";
import type { FetchedImage } from "./image-fetcher";
import { MAX_IMAGE_BYTES, MAX_IMAGE_WIDTH, ALLOWED_MEDIA_TYPES } from "./image-constraints";

const FETCH_TIMEOUT_MS = 15_000;

export const CLOUDINARY_URL_RE = /^https:\/\/res\.cloudinary\.com\//;

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error(
      "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET must be set to fetch private Cloudinary images",
    );
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
  configured = true;
}

function signCloudinaryUrl(url: string): string {
  ensureConfigured();

  const { pathname } = new URL(url);
  // pathname: /{cloud_name}/{resource_type}/{delivery_type}/[v{version}/]{public_id}.{format}
  const parts = pathname.split("/").filter(Boolean);
  const resourceType = parts[1] ?? "image";
  const deliveryType = parts[2] ?? "authenticated";
  const rest = parts.slice(3);

  // Strip the version segment (v + digits) if present
  const versionIdx = rest.findIndex((p) => /^v\d+$/.test(p));
  const pathAfterVersion = versionIdx !== -1 ? rest.slice(versionIdx + 1) : rest;

  // Split public_id and format from the last path segment
  const last = pathAfterVersion[pathAfterVersion.length - 1];
  const dotIdx = last.lastIndexOf(".");
  const format = dotIdx !== -1 ? last.slice(dotIdx + 1) : undefined;
  const idBase = dotIdx !== -1 ? last.slice(0, dotIdx) : last;
  const publicId = [...pathAfterVersion.slice(0, -1), idBase].join("/");

  return cloudinary.url(publicId, {
    resource_type: resourceType as "image" | "video" | "raw" | "auto",
    type: deliveryType,
    sign_url: true,
    ...(format && { format }),
    secure: true,
  });
}

export async function fetchCloudinaryImage(url: string): Promise<FetchedImage> {
  const signedUrl = signCloudinaryUrl(url);

  const response = await fetch(signedUrl, {
    method: "GET",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "error",
    credentials: "omit",
    headers: { "User-Agent": "ScribeKit/1.0" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.has(contentType)) {
    throw new Error(`Unsupported image type "${contentType}" for ${url}`);
  }

  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > MAX_IMAGE_BYTES) {
      reader.cancel();
      throw new Error(`Image exceeds ${MAX_IMAGE_BYTES} bytes: ${url}`);
    }
    chunks.push(value);
  }

  const raw = Buffer.concat(chunks);
  const resized = await sharp(raw)
    .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
    .toBuffer();

  return { url, base64: resized.toString("base64"), mediaType: contentType };
}
