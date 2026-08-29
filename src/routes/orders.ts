import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  createOrderHandler,
  cancelOrderHandler,
  cancelOrderBySellerHandler,
  confirmOrderHandler,
  dispatchOrderHandler,
  completeOrderHandler,
} from "../controllers/orders.js";

const router = Router();

router.post("/:orderId/dispatch", authMiddleware, dispatchOrderHandler);
router.post("/:orderId/cancel", authMiddleware, cancelOrderHandler);
router.post("/:orderId/seller-cancel", authMiddleware, cancelOrderBySellerHandler);
router.post("/:orderId/confirm", authMiddleware, confirmOrderHandler);
router.post("/:orderId/complete", authMiddleware, completeOrderHandler);

export default router;
