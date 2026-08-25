import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { createOrderHandler, cancelOrderHandler } from "../controllers/orders.js";

const router = Router();

router.post("/", authMiddleware, createOrderHandler);
router.post("/:orderId/cancel", authMiddleware, cancelOrderHandler);

export default router;
