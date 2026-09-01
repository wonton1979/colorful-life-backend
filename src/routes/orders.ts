import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  createOrderHandler,
  cancelOrderHandler,
  cancelOrderBySellerHandler,
  confirmOrderHandler,
  dispatchOrderHandler,
  completeOrderHandler,
  processOrderReturnHandler,
  authorizeOrderReturnHandler,
  receiveOrderReturnHandler,
  inspectOrderReturnHandler,
  completeOrderReturnHandler,
  listCustomerOrdersHandler,
  getCustomerOrderHandler,
} from "../controllers/orders.js";
import {
  createPaymentHandler,
  listPaymentsHandler,
} from "../controllers/payments.js";
import {
  createRefundHandler,
  listRefundsHandler,
} from "../controllers/refunds.js";

const router = Router();

router.post("/", authMiddleware, createOrderHandler);
router.get("/", authMiddleware, listCustomerOrdersHandler);
router.get("/:orderId", authMiddleware, getCustomerOrderHandler);
router.post("/:orderId/dispatch", authMiddleware, dispatchOrderHandler);
router.post("/:orderId/cancel", authMiddleware, cancelOrderHandler);
router.post("/:orderId/seller-cancel", authMiddleware, cancelOrderBySellerHandler);
router.post("/:orderId/confirm", authMiddleware, confirmOrderHandler);
router.post("/:orderId/complete", authMiddleware, completeOrderHandler);
router.post("/:orderId/returns", authMiddleware, processOrderReturnHandler);
router.post(
  "/:orderId/returns/:returnId/authorize",
  authMiddleware,
  authorizeOrderReturnHandler,
);
router.post(
  "/:orderId/returns/:returnId/receive",
  authMiddleware,
  receiveOrderReturnHandler,
);
router.post(
  "/:orderId/returns/:returnId/inspect",
  authMiddleware,
  inspectOrderReturnHandler,
);
router.post(
  "/:orderId/returns/:returnId/complete",
  authMiddleware,
  completeOrderReturnHandler,
);
// Payment routes
router.post("/:orderId/payments", authMiddleware, createPaymentHandler);
router.get("/:orderId/payments", authMiddleware, listPaymentsHandler);
router.post("/:orderId/refunds", authMiddleware, createRefundHandler);
router.get("/:orderId/refunds", authMiddleware, listRefundsHandler);

export default router;
