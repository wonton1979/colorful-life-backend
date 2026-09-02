import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireVerifiedEmail } from "../middleware/requireVerifiedEmail.js";
import { receivePurchaseItem, returnPurchaseItem } from "../controllers/purchases.js";

const router = Router();

// POST /purchase-items/:id/receive
router.post("/:id/receive", authMiddleware, requireVerifiedEmail, receivePurchaseItem);
// POST /purchase-items/:id/return
router.post("/:id/return", authMiddleware, requireVerifiedEmail, returnPurchaseItem);

export default router;
