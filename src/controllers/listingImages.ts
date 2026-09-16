import type { Request, Response } from "express";
import { ImageLimitExceededError, ImageNamespaceError, ImageValidationError, InvalidImageOrderError, ListingImageNotFoundError, ListingNotFoundError } from "../domain/listingImages/listingImageErrors.js";
import { createListingImageService } from "../domain/listingImages/listingImageService.js";
import type { ImageStorage } from "../infrastructure/imageStorage/imageStorage.js";

function id(value: string | undefined) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }

export function createListingImageController(storage: ImageStorage) {
  const service = createListingImageService(storage);
  const mapError = (res: Response, error: unknown) => {
    if (error instanceof ImageValidationError || error instanceof InvalidImageOrderError) return res.status(400).json({ error: error.message });
    if (error instanceof ListingNotFoundError || error instanceof ListingImageNotFoundError) return res.status(404).json({ error: error.message });
    if (error instanceof ImageLimitExceededError) return res.status(409).json({ error: error.message });
    if (error instanceof ImageNamespaceError) return res.status(500).json({ error: "Internal server error" });
    console.error("Listing image operation error", error instanceof Error ? error.message : "unknown error");
    return res.status(500).json({ error: "Internal server error" });
  };
  return {
    upload: async (req: Request, res: Response) => {
      const listingId = id(req.params.listingId);
      if (!listingId) return res.status(404).json({ error: "Listing not found" });
      try { return res.status(201).json({ image: await service.upload(listingId, req.file, req.body?.altText) }); } catch (error) { return mapError(res, error); }
    },
    reorder: async (req: Request, res: Response) => {
      const listingId = id(req.params.listingId);
      if (!listingId) return res.status(404).json({ error: "Listing not found" });
      try { return res.json({ images: await service.reorder(listingId, req.body?.imageIds) }); } catch (error) { return mapError(res, error); }
    },
    updateAltText: async (req: Request, res: Response) => {
      const listingId = id(req.params.listingId); const imageId = id(req.params.imageId);
      if (!listingId || !imageId) return res.status(404).json({ error: "Image not found" });
      try { return res.json({ image: await service.updateAltText(listingId, imageId, req.body?.altText) }); } catch (error) { return mapError(res, error); }
    },
    delete: async (req: Request, res: Response) => {
      const listingId = id(req.params.listingId); const imageId = id(req.params.imageId);
      if (!listingId || !imageId) return res.status(404).json({ error: "Image not found" });
      try { await service.delete(listingId, imageId); return res.status(204).send(); } catch (error) { return mapError(res, error); }
    },
  };
}
