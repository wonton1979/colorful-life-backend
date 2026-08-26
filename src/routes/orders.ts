import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { createOrderHandler,cancelOrderHandler, cancelOrderBySellerHandler, confirmOrderHandler } from "../controllers/orders.js";

const router = Router();

router.post("/", authMiddleware, createOrderHandler);
router.post("/:orderId/cancel", authMiddleware, cancelOrderHandler);
router.post("/:orderId/seller-cancel", authMiddleware, cancelOrderBySellerHandler);
router.post("/:orderId/confirm", authMiddleware, confirmOrderHandler);

export default router;
