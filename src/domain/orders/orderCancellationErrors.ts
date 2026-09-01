// Domain error types for order cancellation flow.
// These mirror the style used in other domain modules.

export class OrderNotFoundError extends Error {
  constructor(orderId: number) {
    super(`Order with id ${orderId} not found or does not belong to user`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderNotCancellableError extends Error {
  constructor(orderId: number, status: string) {
    super(`Order ${orderId} cannot be cancelled in its current status: ${status}`);
    this.name = "OrderNotCancellableError";
  }
}

export class InsufficientReservedStockError extends Error {
  constructor(productListingId: number, quantity: number) {
    super(`Insufficient reserved stock for product listing ${productListingId}: required ${quantity}`);
    this.name = "InsufficientReservedStockError";
  }
}
