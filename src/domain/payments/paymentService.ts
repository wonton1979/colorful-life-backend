// src/domain/payments/paymentService.ts

import { prisma } from "../../prisma/runtime.js"
import { Decimal } from "@prisma/client/runtime/client"
import { CreatePaymentInput } from "./paymentValidator.js"
import {
  PaymentConflictError,
  PaymentNotFoundError,
} from "./paymentErrors.js"
import { PaymentProvider, PaymentStatus } from "../../generated/prisma-client/enums.js"

/**
 * Create a manual payment for an existing order.
 *
 * The service follows the exact semantics required for Issue #48 V1:
 *   • amount is taken from Order.totalAmount (must be > 0)
 *   • currency is fixed to "GBP"
 *   • provider is fixed to PaymentProvider.MANUAL
 *   • status is set to PaymentStatus.SUCCEEDED
 *   • paidAt is set to now()
 *   • The operation is idempotent per (provider, providerReference) per order.
 *   • A providerReference that belongs to a different order results in a
 *     PaymentConflictError.
 *   • The unique constraint on (provider, providerReference) guarantees
 *     concurrency safety.  In the rare case of a P2002 during the create
 *     step we recover outside the transaction.
 */
export async function createPayment(
  orderId: number,
  input: CreatePaymentInput
): Promise<
  Awaited<ReturnType<typeof prisma.payment.create>>
> {
  const { providerReference } = input

  // 1️⃣ Validate order exists and fetch its total amount
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { totalAmount: true },
  })
  if (!order) {
    throw new PaymentNotFoundError(orderId)
  }
  const amount = order.totalAmount
  if (amount.lte(new Decimal(0))) {
    // Defensive check – an order should never have a non‑positive total.
    throw new Error(`Order total amount must be positive`) // Domain error could be added if desired
  }

  let payment:
    | Awaited<ReturnType<typeof prisma.payment.create>>
    | Awaited<ReturnType<typeof prisma.payment.findFirst>>
  try {
    payment = await prisma.$transaction(async (tx) => {
      // 2️⃣ Check for existing payment with same provider & reference
      const existing = await tx.payment.findFirst({
        where: { provider: PaymentProvider.MANUAL, providerReference },
      })
      if (existing) {
        if (existing.orderId !== orderId) {
          throw new PaymentConflictError(orderId, existing.orderId)
        }
        return existing
      }
      // 3️⃣ Create the new payment – let any P2002 bubble up to the outer catch
      return await tx.payment.create({
        data: {
          orderId,
          amount,
          currency: "GBP",
          provider: PaymentProvider.MANUAL,
          providerReference,
          status: PaymentStatus.SUCCEEDED,
          paidAt: new Date(),
        },
      })
    })
  } catch (err: unknown) {
    // Handle unique‑constraint violation that happened inside the transaction
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as any).code === "P2002"
    ) {
      const conflict = await prisma.payment.findFirst({
        where: { provider: PaymentProvider.MANUAL, providerReference },
      })
      if (!conflict) throw err // unexpected – rethrow
      if (conflict.orderId !== orderId) {
        throw new PaymentConflictError(orderId, conflict.orderId)
      }
      payment = conflict
    } else {
      throw err
    }
  }
  return payment as Awaited<ReturnType<typeof prisma.payment.create>>
}
