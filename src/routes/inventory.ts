import { Router } from "express";
import { createInventoryAdjustment } from "../controllers/inventory.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

router.post("/condition-adjustments", authMiddleware, createInventoryAdjustment);

export default router;
