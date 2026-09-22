import type { Prisma } from "../../generated/prisma-client/client.js";

// All purchase mutations acquire the parent first, before claiming individual lines.
export async function lockPurchase(tx: Prisma.TransactionClient, purchaseId: number) {
  await tx.$queryRaw`SELECT id FROM "Purchase" WHERE id = ${purchaseId} FOR UPDATE`;
}

export async function lockPurchaseForItem(tx: Prisma.TransactionClient, itemId: number) {
  const item = await tx.purchaseItem.findUnique({ where: { id: itemId }, select: { purchaseDocument: { select: { purchaseId: true } } } });
  if (item) await lockPurchase(tx, item.purchaseDocument.purchaseId);
}
