import type { Request, Response } from "express";
import { CatalogueArtworkListingNotFoundError, createCatalogueArtworkService } from "../domain/catalogueArtwork/catalogueArtworkService.js";
import { ImageValidationError } from "../domain/listingImages/listingImageErrors.js";
import type { ImageStorage } from "../infrastructure/imageStorage/imageStorage.js";

function listingId(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createCatalogueArtworkController(storage: ImageStorage) {
  const service = createCatalogueArtworkService(storage);
  const mapError = (res: Response, error: unknown) => {
    if (error instanceof ImageValidationError) return res.status(400).json({ error: error.message });
    if (error instanceof CatalogueArtworkListingNotFoundError) return res.status(404).json({ error: error.message });
    console.error("Catalogue artwork operation error", error instanceof Error ? error.message : "unknown error");
    return res.status(500).json({ error: "Internal server error" });
  };
  return {
    set: async (req: Request, res: Response) => {
      const id = listingId(req.params.listingId);
      if (!id) return res.status(404).json({ error: "Listing not found" });
      try { return res.status(200).json({ catalogueArtwork: await service.set(id, req.file) }); } catch (error) { return mapError(res, error); }
    },
    remove: async (req: Request, res: Response) => {
      const id = listingId(req.params.listingId);
      if (!id) return res.status(404).json({ error: "Listing not found" });
      try { await service.remove(id); return res.status(204).send(); } catch (error) { return mapError(res, error); }
    },
  };
}
