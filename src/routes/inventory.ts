import { Router } from "express";
import { createInventoryAdjustment, reconcileStocktakeInventory } from "../controllers/inventory.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

router.post("/condition-adjustments", authMiddleware, createInventoryAdjustment);
router.post("/stocktakes", authMiddleware, reconcileStocktakeInventory);

export default router;
