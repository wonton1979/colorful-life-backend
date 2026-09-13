import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { addCartItemHandler, clearCartHandler, getCartHandler, removeCartItemHandler, updateCartItemHandler } from "../controllers/cart.js";

const router = Router();
router.use(authMiddleware);
router.get("/", getCartHandler);
router.post("/items", addCartItemHandler);
router.patch("/items/:productListingId", updateCartItemHandler);
router.delete("/items/:productListingId", removeCartItemHandler);
router.delete("/", clearCartHandler);
export default router;
