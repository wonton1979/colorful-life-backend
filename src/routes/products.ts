import { Router } from "express";
import { getProducts, getProductById, createProduct, updateProduct, deactivateProduct, reactivateProduct, adjustInventory, getInventoryMovements } from "../controllers/products.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

router.get("/", getProducts);
// Register inventory movements route before the generic :id route to avoid conflict
router.get("/:id/inventory-movements", authMiddleware, getInventoryMovements);
router.get("/:id", getProductById);
router.post("/", createProduct);
router.patch("/:id", updateProduct);
router.patch("/:id/deactivate", deactivateProduct);
router.patch("/:id/reactivate", reactivateProduct);
router.post("/:id/inventory-adjustments", authMiddleware, adjustInventory);

export default router;
