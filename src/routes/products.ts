import { Router } from "express";
import { getProducts, getProductById, createProduct, updateProduct } from "../controllers/products.js";

const router = Router();

router.get("/", getProducts);
router.get("/:id", getProductById);
router.post("/", createProduct);
router.patch("/:id", updateProduct);

export default router;
