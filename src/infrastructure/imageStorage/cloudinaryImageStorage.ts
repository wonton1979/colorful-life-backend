import { v2 as cloudinary } from "cloudinary";
import { config } from "../../config/index.js";
import type { ImageStorage, ImageUploadInput, StoredImage } from "./imageStorage.js";

export const PRODUCT_IMAGE_FOLDER = "colorful-life/products";
export const CATALOGUE_ARTWORK_FOLDER = "colorful-life/catalogue-artwork";
export const CATEGORY_ARTWORK_FOLDER = "colorful-life/category-artwork";

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

export function isProductImagePublicId(publicId: string): boolean {
  // The database row's LegoProduct relation is the owner check. Numeric
  // prefixes support both pre-migration listing-scoped assets and new
  // product-scoped assets while all resources remain in the product folder.
  return new RegExp(`^${PRODUCT_IMAGE_FOLDER}/[1-9][0-9]*-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, "i").test(publicId);
}

export function isCatalogueArtworkPublicId(publicId: string): boolean {
  // See isProductImagePublicId: migrated resources retain their original
  // public IDs, while the LegoProduct row is the authoritative owner.
  return new RegExp(`^${CATALOGUE_ARTWORK_FOLDER}/[1-9][0-9]*-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, "i").test(publicId);
}

export function isOwnedCategoryArtworkPublicId(publicId: string, categoryId: number): boolean {
  return new RegExp("^" + CATEGORY_ARTWORK_FOLDER + "/" + categoryId + "-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", "i").test(publicId);
}

function createCloudinaryStorage(folder: string): ImageStorage {
  return {
    async upload(input: ImageUploadInput): Promise<StoredImage> {
      const provider = configureCloudinary();
      return new Promise((resolve, reject) => {
        const stream = provider.uploader.upload_stream(
          {
            resource_type: "image",
            type: "upload",
            folder,
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
}

export const cloudinaryImageStorage = createCloudinaryStorage(PRODUCT_IMAGE_FOLDER);
export const cloudinaryCatalogueArtworkStorage = createCloudinaryStorage(CATALOGUE_ARTWORK_FOLDER);
export const cloudinaryCategoryArtworkStorage = createCloudinaryStorage(CATEGORY_ARTWORK_FOLDER);
