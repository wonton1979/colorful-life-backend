import { Request, Response } from "express";
import { createRefund, getOrderRefunds } from "../domain/refunds/refundService.js";
import { createOrReusePayPalRefund, PayPalRefundProviderError, PayPalRefundValidationError } from "../domain/refunds/paypalRefundService.js";
import { createOrReuseStripeRefund, StripeRefundProviderError, StripeRefundValidationError } from "../domain/refunds/stripeRefundService.js";
import { prisma } from "../prisma/runtime.js";
import { PaymentProvider } from "../generated/prisma-client/enums.js";
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

  const { paymentId, amount, providerReference, reason, refundId } = parseResult.data;

  try {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { orderId: true, provider: true } });
    if (!payment || payment.orderId !== orderId) return res.status(404).json({ error: "Payment not found for order" });
    if (payment.provider === PaymentProvider.PAYPAL) {
      if (providerReference !== undefined) return res.status(400).json({ error: "providerReference is only valid for manual refunds" });
      const refund = await createOrReusePayPalRefund(orderId, paymentId, amount, reason, user.id, undefined, refundId);
      return res.status(refundId ? 200 : 201).json({ refundId: refund.id, status: refund.status, amount: refund.amount, currency: refund.currency, provider: refund.provider });
    }
    if (payment.provider === PaymentProvider.STRIPE) {
      if (providerReference !== undefined) return res.status(400).json({ error: "providerReference is only valid for manual refunds" });
      const refund = await createOrReuseStripeRefund(orderId, paymentId, amount, reason, user.id, undefined, refundId);
      return res.status(refundId ? 200 : 201).json({ refundId: refund.id, status: refund.status, amount: refund.amount, currency: refund.currency, provider: refund.provider });
    }
    if (refundId !== undefined) return res.status(400).json({ error: "refundId is only valid for PayPal refunds" });
    if (providerReference === undefined) return res.status(400).json({ error: "Refund provider reference cannot be empty" });
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
    if (err instanceof PayPalRefundValidationError) return res.status(409).json({ error: "PayPal refund request is not valid" });
    if (err instanceof PayPalRefundProviderError) return res.status(503).json({ error: "Payment service unavailable" });
    if (err instanceof StripeRefundValidationError) return res.status(409).json({ error: "Stripe refund request is not valid" });
    if (err instanceof StripeRefundProviderError) return res.status(503).json({ error: "Payment service unavailable" });
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
