import { fileTypeFromBuffer } from "file-type";
import { ImageValidationError } from "./productImageErrors.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 10;
export const SUPPORTED_IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export async function validateImage(file: Express.Multer.File | undefined) {
  if (!file || !file.buffer) throw new ImageValidationError("No image file provided");
  if (file.size === 0 || file.buffer.length === 0) throw new ImageValidationError("Uploaded image is empty");
  if (file.size > MAX_IMAGE_BYTES || file.buffer.length > MAX_IMAGE_BYTES) {
    throw new ImageValidationError("Uploaded image exceeds the 8 MiB limit");
  }
  if (!(file.mimetype in SUPPORTED_IMAGE_TYPES)) throw new ImageValidationError("Unsupported image format");

  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected || detected.mime !== file.mimetype || !(detected.mime in SUPPORTED_IMAGE_TYPES)) {
    throw new ImageValidationError("Uploaded content is not a valid supported image");
  }
  return { mimeType: detected.mime };
}

export function parseOptionalAltText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new ImageValidationError("altText must be a string");
  const trimmed = value.trim();
  if (trimmed.length > 300) throw new ImageValidationError("altText must be 300 characters or fewer");
  return trimmed || null;
}
