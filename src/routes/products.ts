import { Router } from "express";
import { getProducts, getProductById, createProduct, updateProduct, deactivateProduct, reactivateProduct } from "../controllers/products.js";

const router = Router();

router.get("/", getProducts);
router.get("/:id", getProductById);
router.post("/", createProduct);
router.patch("/:id", updateProduct);
router.patch("/:id/deactivate", deactivateProduct);
router.patch("/:id/reactivate", reactivateProduct);

export default router;
