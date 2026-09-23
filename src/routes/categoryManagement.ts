import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.js";
import { cloudinaryCategoryArtworkStorage } from "../infrastructure/imageStorage/cloudinaryImageStorage.js";
import type { ImageStorage } from "../infrastructure/imageStorage/imageStorage.js";
import { createCategoryManagementController } from "../controllers/categoryManagement.js";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) return cb(new Error("Unsupported image format"));
  cb(null, true);
} });
const adminOnly = (req: Request, res: Response, next: NextFunction) => (req.user as { role: string }).role === "ADMIN" ? next() : res.status(403).json({ error: "Forbidden: ADMIN only" });
function uploadMiddleware(req: Request, res: Response, next: NextFunction) { upload.single("file")(req, res, (error) => { if (error) return res.status(400).json({ error: error.message }); next(); }); }
export function createCategoryManagementRouter(storage: ImageStorage = cloudinaryCategoryArtworkStorage) {
  const controller = createCategoryManagementController(storage);
  const router = Router();
  router.use(authMiddleware, adminOnly);
  router.get("/", controller.list);
  router.post("/", controller.create);
  router.patch("/:id", controller.update);
  router.put("/:id/artwork", uploadMiddleware, controller.setArtwork);
  router.delete("/:id/artwork", controller.removeArtwork);
  return router;
}
export default createCategoryManagementRouter();
