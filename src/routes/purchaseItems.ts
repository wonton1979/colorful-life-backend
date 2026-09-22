import { Router, type Request, type Response, type NextFunction } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireVerifiedEmail } from "../middleware/requireVerifiedEmail.js";
import { receivePurchaseItem, returnPurchaseItem } from "../controllers/purchases.js";

const router = Router();
const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== "ADMIN") { res.status(403).json({ error: "Forbidden: ADMIN only" }); return; }
  next();
};

// POST /purchase-items/:id/receive
router.post("/:id/receive", authMiddleware, requireVerifiedEmail, adminOnly, receivePurchaseItem);
// POST /purchase-items/:id/return
router.post("/:id/return", authMiddleware, requireVerifiedEmail, adminOnly, returnPurchaseItem);

export default router;
