export interface ImageUploadInput {
  buffer: Buffer;
  mimeType: string;
  publicId: string;
}

export interface StoredImage {
  publicId: string;
  secureUrl: string;
}

export interface ImageStorage {
  upload(input: ImageUploadInput): Promise<StoredImage>;
  delete(publicId: string): Promise<void>;
}
