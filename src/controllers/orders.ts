import { Request, Response } from "express";
import { CreateOrderSchema } from "../domain/orders/orderValidator.js";
import { createOrder } from "../domain/orders/orderService.js";
import {
  NoDefaultBillingAddressError,
  MultipleDefaultBillingAddressesError,
  ProductListingNotFoundError,
  ProductListingInactiveError,
  DuplicateProductListingError,
} from "../domain/orders/orderErrors.js";
import {
  CancelOrderSchema,
  SellerCancelOrderSchema,
} from "../domain/orders/orderCancellationValidator.js";
import { cancelOrder, cancelOrderByAdmin } from "../domain/orders/orderCancellationService.js";
import { confirmOrder } from "../domain/orders/orderConfirmationService.js";
import {
  OrderNotFoundError as OrderNotFoundErrorCancel,
  OrderNotCancellableError,
} from "../domain/orders/orderCancellationErrors.js";
import {
  OrderNotFoundError as OrderNotFoundErrorConfirm,
  OrderNotConfirmableError,
  InsufficientStockError,
} from "../domain/orders/orderConfirmationErrors.js";

export const createOrderHandler = async (req: Request, res: Response) => {
  const parseResult = CreateOrderSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }
  const userId = (req.user as { id: number }).id;
  try {
    const order = await createOrder(userId, parseResult.data);
    return res.status(201).json(order);
  } catch (err: unknown) {
      if (
        err instanceof NoDefaultBillingAddressError ||
        err instanceof MultipleDefaultBillingAddressesError ||
        err instanceof ProductListingNotFoundError ||
        err instanceof ProductListingInactiveError ||
        err instanceof DuplicateProductListingError
    ) {
      return res.status(400).json({ error: err.message });
    }
    console.error("Order creation error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
/**
 * ADMIN seller cancellation handler.
 * Requires the requester to be an ADMIN.
 */
export const cancelOrderBySellerHandler = async (req: Request, res: Response) => {
  const userRole = (req.user as { role: string }).role;
  if (userRole !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden: ADMIN only" });
  }
  const parseResult = SellerCancelOrderSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return res.status(400).json({ error: "Invalid order id" });
  }
  try {
    const order = await cancelOrderByAdmin(orderId, parseResult.data.reason);
    return res.status(200).json(order);
  } catch (err: unknown) {
    if (err instanceof OrderNotFoundErrorCancel) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof OrderNotCancellableError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("Seller order cancellation error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ADMIN order confirmation handler
export const confirmOrderHandler = async (req: Request, res: Response) => {
  const userRole = (req.user as { role: string }).role;
  if (userRole !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden: ADMIN only" });
  }
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return res.status(400).json({ error: "Invalid order id" });
  }
  try {
    const adminUserId = (req.user as { id: number }).id;
    const order = await confirmOrder(adminUserId, orderId);
    return res.status(200).json(order);
  } catch (err: unknown) {
    if (err instanceof OrderNotFoundErrorConfirm) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof OrderNotConfirmableError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof InsufficientStockError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("Order confirmation error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const cancelOrderHandler = async (req: Request, res: Response) => {
  const parseResult = CancelOrderSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }
  const userId = (req.user as { id: number }).id;
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return res.status(400).json({ error: "Invalid order id" });
  }
  try {
    const order = await cancelOrder(userId, orderId, parseResult.data.reason);
    return res.status(200).json(order);
  } catch (err: unknown) {
    if (err instanceof OrderNotFoundErrorCancel) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof OrderNotCancellableError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("Order cancellation error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
