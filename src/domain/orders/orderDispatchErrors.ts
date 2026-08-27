// Domain error types for order dispatch flow.
// Mirrors the style used in other domain modules.

export class OrderNotFoundError extends Error {
  constructor(orderId: number) {
    super(`Order with id ${orderId} not found`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderNotDispatchableError extends Error {
  constructor(orderId: number, status: string) {
    super(`Order ${orderId} cannot be dispatched in its current status: ${status}`);
    this.name = "OrderNotDispatchableError";
  }
}
