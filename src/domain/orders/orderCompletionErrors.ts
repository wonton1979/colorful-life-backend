export class OrderNotCompletableError extends Error {
  constructor(orderId: number, status: string) {
    super(`Order ${orderId} cannot be completed in its current status: ${status}`);
    this.name = "OrderNotCompletableError";
  }
}
