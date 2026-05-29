import sharp from "sharp";
import { validateUrl } from "./url-validator";
import { CLOUDINARY_URL_RE, fetchCloudinaryImage } from "./cloudinary-fetcher";
import { MAX_IMAGE_BYTES, MAX_IMAGE_WIDTH, ALLOWED_MEDIA_TYPES } from "./image-constraints";

const FETCH_TIMEOUT_MS = 15_000; // higher than fetch_url's 10s — images are larger

export interface FetchedImage {
  url: string;
  base64: string;
  mediaType: string;
}

export interface ImageFetchResult {
  url: string;
  status: "success" | "error";
  image?: FetchedImage;
  mediaType?: string;
  bytes?: number;
  reason?: string;
}

export async function fetchImage(url: string): Promise<FetchedImage> {
  const validation = await validateUrl(url);
  if (!validation.safe) {
    throw new Error(`URL validation failed for ${url}: ${validation.reason}`);
  }

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

export async function fetchImages(urls: string[]): Promise<ImageFetchResult[]> {
  const results = await Promise.allSettled(
    urls.map((url) => (CLOUDINARY_URL_RE.test(url) ? fetchCloudinaryImage(url) : fetchImage(url))),
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") {
      const img = result.value;
      return {
        url: urls[i],
        status: "success" as const,
        image: img,
        mediaType: img.mediaType,
        bytes: Buffer.byteLength(img.base64, "base64"),
      };
    }
    return {
      url: urls[i],
      status: "error" as const,
      reason: result.reason.message,
    };
  });
}
