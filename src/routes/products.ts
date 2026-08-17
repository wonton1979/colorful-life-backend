import { Router } from "express";
import { getProducts, getProductById, createProduct, updateProduct, deactivateProduct, reactivateProduct, adjustInventory } from "../controllers/products.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

router.get("/", getProducts);
router.get("/:id", getProductById);
router.post("/", createProduct);
router.patch("/:id", updateProduct);
router.patch("/:id/deactivate", deactivateProduct);
router.patch("/:id/reactivate", reactivateProduct);
router.post("/:id/inventory-adjustments", authMiddleware, adjustInventory);

export default router;
