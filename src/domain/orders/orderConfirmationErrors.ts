// Domain error types for order confirmation flow.
// These mirror the style used in other domain modules.

export class OrderNotFoundError extends Error {
  constructor(orderId: number) {
    super(`Order with id ${orderId} not found`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderNotConfirmableError extends Error {
  constructor(orderId: number, status: string) {
    super(`Order ${orderId} cannot be confirmed in its current status: ${status}`);
    this.name = "OrderNotConfirmableError";
  }
}

export class InsufficientStockError extends Error {
  constructor(listingId: number, available: number, required: number) {
    super(`Insufficient stock for listing ${listingId}: available ${available}, required ${required}`);
    this.name = "InsufficientStockError";
  }
}
