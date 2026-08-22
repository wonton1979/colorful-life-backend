import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { receivePurchaseItem } from "../controllers/purchases.js";

const router = Router();

// POST /purchase-items/:id/receive
router.post("/:id/receive", authMiddleware, receivePurchaseItem);

export default router;
