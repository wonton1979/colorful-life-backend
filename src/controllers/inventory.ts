import type { Request, Response } from "express";
import { InventoryAdjustmentRequestSchema } from "../domain/inventory/inventoryAdjustmentValidator.js";
import {
  conditionAdjustInventory,
  writeOffInventory,
  InvalidConditionAdjustmentError,
  InvalidInventoryAdjustmentReasonError,
  InvalidInventoryAdjustmentQuantityError,
  InventoryInsufficientStockError,
  InventoryListingNotFoundError,
  InventoryListingsMustDifferError,
  InventoryListingsMustShareProductError,
} from "../domain/inventory/inventoryAdjustmentService.js";

export const createInventoryAdjustment = async (req: Request, res: Response) => {
  const user = req.user as { id: number; role: string };
  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden: ADMIN only" });
  }

  const parsed = InventoryAdjustmentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.format() });
  }

  try {
    const input = parsed.data;
    const result = input.action === "CONDITION_ADJUSTMENT"
      ? await conditionAdjustInventory({ ...input, performedByUserId: user.id })
      : await writeOffInventory({ ...input, performedByUserId: user.id });
    return res.status(201).json(result);
  } catch (err: unknown) {
    if (err instanceof InventoryListingNotFoundError) return res.status(404).json({ error: err.message });
    if (err instanceof InvalidConditionAdjustmentError || err instanceof InvalidInventoryAdjustmentQuantityError || err instanceof InvalidInventoryAdjustmentReasonError) return res.status(400).json({ error: err.message });
    if (err instanceof InventoryInsufficientStockError || err instanceof InventoryListingsMustDifferError || err instanceof InventoryListingsMustShareProductError) return res.status(409).json({ error: err.message });
    console.error("Inventory adjustment error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
