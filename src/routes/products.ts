import { Router, type Request, type Response, type NextFunction } from "express";
import { getProducts, getProductById, createProduct, updateProduct, deactivateProduct, reactivateProduct, adjustInventory, getInventoryMovements } from "../controllers/products.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  if ((req.user as { role: string }).role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden: ADMIN only" });
  }
  next();
};

router.get("/", getProducts);
// Register inventory movements route before the generic :id route to avoid conflict
router.get("/:id/inventory-movements", authMiddleware, adminOnly, getInventoryMovements);
router.get("/:id", getProductById);
router.post("/", authMiddleware, adminOnly, createProduct);
router.patch("/:id", authMiddleware, adminOnly, updateProduct);
router.patch("/:id/deactivate", authMiddleware, adminOnly, deactivateProduct);
router.patch("/:id/reactivate", authMiddleware, adminOnly, reactivateProduct);
router.post("/:id/inventory-adjustments", authMiddleware, adminOnly, adjustInventory);

export default router;
