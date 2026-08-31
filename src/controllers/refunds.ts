import { Request, Response } from "express";
import { createRefund, getOrderRefunds } from "../domain/refunds/refundService.js";
import { CreateRefundSchema } from "../domain/refunds/refundValidator.js";
import {
  RefundAmountExceededError,
  RefundInvalidAmountError,
  RefundInvalidProviderReferenceError,
  RefundInvalidReasonError,
  RefundOrderNotFoundError,
  RefundPaymentNotFoundError,
  RefundPaymentNotRefundableError,
  RefundProviderReferenceConflictError,
} from "../domain/refunds/refundErrors.js";

export const createRefundHandler = async (req: Request, res: Response) => {
  const user = req.user as { id: number; role: string };
  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden: ADMIN only" });
  }

  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return res.status(400).json({ error: "Invalid order id" });
  }

  const parseResult = CreateRefundSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }

  const { paymentId, amount, providerReference, reason } = parseResult.data;

  try {
    const result = await createRefund(
      orderId,
      paymentId,
      amount,
      providerReference,
      reason,
      user.id,
    );
    return res.status(result.created ? 201 : 200).json(result.refund);
  } catch (err: unknown) {
    if (
      err instanceof RefundInvalidAmountError ||
      err instanceof RefundInvalidProviderReferenceError ||
      err instanceof RefundInvalidReasonError
    ) {
      return res.status(400).json({ error: err.message });
    }
    if (
      err instanceof RefundOrderNotFoundError ||
      err instanceof RefundPaymentNotFoundError
    ) {
      return res.status(404).json({ error: err.message });
    }
    if (
      err instanceof RefundPaymentNotRefundableError ||
      err instanceof RefundAmountExceededError ||
      err instanceof RefundProviderReferenceConflictError
    ) {
      return res.status(409).json({ error: err.message });
    }
    console.error("Create refund error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const listRefundsHandler = async (req: Request, res: Response) => {
  const userRole = (req.user as { role: string }).role;
  if (userRole !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden: ADMIN only" });
  }

  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return res.status(400).json({ error: "Invalid order id" });
  }

  try {
    const refunds = await getOrderRefunds(orderId);
    return res.status(200).json(refunds);
  } catch (err: unknown) {
    if (err instanceof RefundOrderNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    console.error("List refunds error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
