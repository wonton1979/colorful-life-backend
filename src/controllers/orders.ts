import { Request, Response } from "express";
import { prisma } from "../prisma/runtime.js";
import { CreateOrderSchema } from "../domain/orders/orderValidator.js";
import { createOrder } from "../domain/orders/orderService.js";
import type { CreateOrderInput } from "../domain/orders/orderValidator.js";
import {
  NoDefaultBillingAddressError,
  MultipleDefaultBillingAddressesError,
  ProductListingNotFoundError,
  ProductListingInactiveError,
  DuplicateProductListingError,
} from "../domain/orders/orderErrors.js";

export const createOrderHandler = async (req: Request, res: Response) => {
  const parseResult = CreateOrderSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }
  const userId = (req.user as { id: number }).id;
  try {
    const order = await createOrder(userId, parseResult.data);
    return res.status(201).json(order);
  } catch (err: unknown) {
    if (
      err instanceof NoDefaultBillingAddressError ||
      err instanceof MultipleDefaultBillingAddressesError ||
      err instanceof ProductListingNotFoundError ||
      err instanceof ProductListingInactiveError ||
      err instanceof DuplicateProductListingError
    ) {
      return res.status(400).json({ error: err.message });
    }
    console.error("Order creation error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
