import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.js";
import { cloudinaryImageStorage } from "../infrastructure/imageStorage/cloudinaryImageStorage.js";
import { createListingImageController } from "../controllers/listingImages.js";
import type { ImageStorage } from "../infrastructure/imageStorage/imageStorage.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) return cb(new Error("Unsupported image format"));
  cb(null, true);
} });

const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  if ((req.user as { role: string }).role !== "ADMIN") return res.status(403).json({ error: "Forbidden: ADMIN only" });
  next();
};

function uploadMiddleware(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.message });
    next();
  });
}

export function createListingImagesRouter(storage: ImageStorage = cloudinaryImageStorage) {
  const controller = createListingImageController(storage);
  const router = Router();
  router.post("/:listingId/images", authMiddleware, adminOnly, uploadMiddleware, controller.upload);
  router.patch("/:listingId/images/order", authMiddleware, adminOnly, controller.reorder);
  router.patch("/:listingId/images/:imageId", authMiddleware, adminOnly, controller.updateAltText);
  router.delete("/:listingId/images/:imageId", authMiddleware, adminOnly, controller.delete);
  return router;
}

export default createListingImagesRouter();
