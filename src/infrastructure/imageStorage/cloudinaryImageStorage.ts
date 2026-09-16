import { v2 as cloudinary } from "cloudinary";
import { config } from "../../config/index.js";
import type { ImageStorage, ImageUploadInput, StoredImage } from "./imageStorage.js";

export const PRODUCT_IMAGE_FOLDER = "colorful-life/products";

function configureCloudinary() {
  if (!config.CLOUDINARY_CLOUD_NAME || !config.CLOUDINARY_API_KEY || !config.CLOUDINARY_API_SECRET) {
    throw new Error("Cloudinary configuration is missing");
  }
  cloudinary.config({
    cloud_name: config.CLOUDINARY_CLOUD_NAME,
    api_key: config.CLOUDINARY_API_KEY,
    api_secret: config.CLOUDINARY_API_SECRET,
  });
  return cloudinary;
}

export function isOwnedProductPublicId(publicId: string, listingId: number): boolean {
  return new RegExp(`^${PRODUCT_IMAGE_FOLDER}/${listingId}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, "i").test(publicId);
}

export const cloudinaryImageStorage: ImageStorage = {
  async upload(input: ImageUploadInput): Promise<StoredImage> {
    const provider = configureCloudinary();
    return new Promise((resolve, reject) => {
      const stream = provider.uploader.upload_stream(
        {
          resource_type: "image",
          type: "upload",
          folder: PRODUCT_IMAGE_FOLDER,
          public_id: input.publicId,
          overwrite: false,
          unique_filename: false,
          use_filename: false,
        },
        (error, result) => {
          if (error || !result?.public_id || !result.secure_url) {
            reject(error ?? new Error("Cloudinary upload returned an incomplete result"));
            return;
          }
          resolve({ publicId: result.public_id, secureUrl: result.secure_url });
        },
      );
      stream.end(input.buffer);
    });
  },

  async delete(publicId: string): Promise<void> {
    const provider = configureCloudinary();
    const result = await provider.uploader.destroy(publicId, {
      resource_type: "image",
      type: "upload",
      invalidate: true,
    });
    if (result.result !== "ok" && result.result !== "not found") {
      throw new Error(`Cloudinary deletion failed: ${result.result}`);
    }
  },
};
