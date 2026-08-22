import { Router } from "express";
import multer from "multer";
import type { Request, Response, NextFunction } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { importPurchaseInvoice, listPurchases, getPurchaseById, createManualPurchase } from "../controllers/purchases.js";

const router = Router();

// Multer configuration – in‑memory storage, 10 MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed"));
    }
    cb(null, true);
  },
});

// Middleware wrapper to surface Multer errors as 400 responses
function uploadMiddleware(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: any) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}

router.post("/import", authMiddleware, uploadMiddleware, importPurchaseInvoice);
router.get("/", authMiddleware, listPurchases);
router.get("/:id", authMiddleware, getPurchaseById);
router.post("/manual", authMiddleware, createManualPurchase);

export default router;
