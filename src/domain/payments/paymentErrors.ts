export class PaymentNotFoundError extends Error {
  constructor(orderId: number) {
    super(`Order with id ${orderId} not found`)
    this.name = "PaymentNotFoundError"
  }
}

export class PaymentAlreadySucceededError extends Error {
  constructor(orderId: number) {
    super(`Payment for order ${orderId} has already succeeded`)
    this.name = "PaymentAlreadySucceededError"
  }
}

export class PaymentConflictError extends Error {
  constructor(orderId: number, conflictingOrderId: number) {
    super(
      `Payment providerReference belongs to a different order. Existing order id: ${conflictingOrderId}`
    )
    this.name = "PaymentConflictError"
  }
}
