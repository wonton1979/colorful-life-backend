import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.js";
import { cloudinaryImageStorage } from "../infrastructure/imageStorage/cloudinaryImageStorage.js";
import type { ImageStorage } from "../infrastructure/imageStorage/imageStorage.js";
import { createUsedOfferController } from "../controllers/usedOffers.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 3 }, fileFilter: (_req, file, cb) => {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) return cb(new Error("Unsupported image format"));
  cb(null, true);
} });
const adminOnly = (req: Request, res: Response, next: NextFunction) => (req.user as { role: string }).role === "ADMIN" ? next() : res.status(403).json({ error: "Forbidden: ADMIN only" });
function uploads(req: Request, res: Response, next: NextFunction) { upload.array("conditionPhotos", 3)(req, res, (error) => error ? res.status(400).json({ error: error.message }) : next()); }

export function createUsedOffersRouter(storage: ImageStorage = cloudinaryImageStorage) {
  const controller = createUsedOfferController(storage);
  const router = Router();
  router.post("/:productId/used-offers", authMiddleware, adminOnly, uploads, controller.create);
  return router;
}
export function createConditionConversionRouter(storage: ImageStorage = cloudinaryImageStorage) {
  const controller = createUsedOfferController(storage);
  const router = Router();
  router.post("/condition-conversions/:productId", authMiddleware, adminOnly, uploads, controller.convert);
  return router;
}
export default createUsedOffersRouter();
