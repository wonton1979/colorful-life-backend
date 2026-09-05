import type { Request, Response } from "express";
import { createOrReuseStripePaymentIntent, StripePaymentAlreadyCompletedError, StripePaymentExpiredError, StripePaymentOrderNotFoundError, StripePaymentOwnershipError, StripePaymentProviderError } from "../domain/payments/stripePaymentService.js";

export async function createStripePaymentIntentHandler(req: Request, res: Response) {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId < 1) return res.status(400).json({ error: "Invalid order id" });
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const result = await createOrReuseStripePaymentIntent(orderId, userId);
    return res.status(201).json({ clientSecret: result.clientSecret });
  } catch (error) {
    if (error instanceof StripePaymentOrderNotFoundError || error instanceof StripePaymentOwnershipError) return res.status(404).json({ error: "Order not found" });
    if (error instanceof StripePaymentExpiredError || error instanceof StripePaymentAlreadyCompletedError) return res.status(409).json({ error: error.message || "Order is not payable" });
    if (error instanceof StripePaymentProviderError) return res.status(503).json({ error: "Payment service unavailable" });
    console.error("Stripe payment initiation error", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
