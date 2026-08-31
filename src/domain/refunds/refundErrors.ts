export class RefundInvalidAmountError extends Error {
  constructor() {
    super("Refund amount must be positive and use two-decimal precision");
    this.name = "RefundInvalidAmountError";
  }
}

export class RefundInvalidProviderReferenceError extends Error {
  constructor() {
    super("Refund provider reference cannot be empty");
    this.name = "RefundInvalidProviderReferenceError";
  }
}

export class RefundInvalidReasonError extends Error {
  constructor() {
    super("Refund reason cannot be empty");
    this.name = "RefundInvalidReasonError";
  }
}

export class RefundOrderNotFoundError extends Error {
  constructor(orderId: number) {
    super(`Order with id ${orderId} not found`);
    this.name = "RefundOrderNotFoundError";
  }
}

export class RefundPaymentNotFoundError extends Error {
  constructor(paymentId: number, orderId: number) {
    super(`Payment ${paymentId} not found for order ${orderId}`);
    this.name = "RefundPaymentNotFoundError";
  }
}

export class RefundPaymentNotRefundableError extends Error {
  constructor(paymentId: number) {
    super(`Payment ${paymentId} is not refundable`);
    this.name = "RefundPaymentNotRefundableError";
  }
}

export class RefundAmountExceededError extends Error {
  constructor(paymentId: number) {
    super(`Refund amount exceeds the remaining refundable payment balance for payment ${paymentId}`);
    this.name = "RefundAmountExceededError";
  }
}

export class RefundProviderReferenceConflictError extends Error {
  constructor(providerReference: string) {
    super(`Refund provider reference ${providerReference} is already used for a different refund`);
    this.name = "RefundProviderReferenceConflictError";
  }
}
