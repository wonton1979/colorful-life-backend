import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "../../generated/prisma-client/client.js";
import { prisma } from "../../prisma/runtime.js";
import { calculatePurchaseCosts } from "./purchaseImport.js";
import { lockPurchase } from "./purchaseLock.js";
import { receivePurchaseItemInTransaction, UsedOfferPurchaseReceiptError } from "./purchaseItemReceiving.js";

export class ReviewError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const id = z.number().int().positive();
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
export const revisionSchema = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const resolutionSchema = revisionSchema.extend({ productListingId: id.nullable() }).strict();
export const amendmentSchema = revisionSchema.extend({
  sourceDescription: z.string().trim().min(1).max(2000),
  sourceSetNumber: z.string().trim().min(1).max(100).nullable(),
  quantity: id.max(1000000).optional(),
  originalGrossUnitCost: money.optional(),
}).strict();

async function readPurchase(tx: Prisma.TransactionClient, userId: number, purchaseId: number) {
  const purchase = await tx.purchase.findFirst({
    where: { id: purchaseId, purchaseDocuments: { some: { importedByUserId: userId } } },
    include: { purchaseDocuments: {
      where: { importedByUserId: userId }, orderBy: { partNumber: "asc" },
      include: { purchaseItems: { orderBy: { id: "asc" }, include: {
        productListing: { select: { id: true, condition: true, active: true, legoProduct: { select: { title: true, setNumber: true } } } },
      } } },
    } },
  });
  if (!purchase) throw new ReviewError(404, "Purchase not found");
  return purchase;
}
type ReviewPurchase = Awaited<ReturnType<typeof readPurchase>>;
type Line = ReviewPurchase["purchaseDocuments"][number]["purchaseItems"][number];
function identity(line: Line): string {
  // No title matching; namespaces deliberately prevent external-ID/set-number collisions.
  if (line.externalProductId?.trim()) return "external:" + line.externalProductId.trim();
  if (line.sourceSetNumber?.trim()) return "set:" + line.sourceSetNumber.trim();
  return "line:" + line.id;
}
function groups(purchase: ReviewPurchase) {
  const result = new Map<string, Line[]>();
  for (const doc of purchase.purchaseDocuments) for (const line of doc.purchaseItems) {
    const key = identity(line);
    result.set(key, [...(result.get(key) ?? []), line]);
  }
  return [...result.values()].map(lines => lines.sort((a, b) => a.id - b.id));
}
const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), new Prisma.Decimal(0));
function represent(purchase: ReviewPurchase) {
  const revision = createHash("sha256").update(JSON.stringify(purchase)).digest("hex");
  return {
    purchase, revision,
    totalCost: sum(purchase.purchaseDocuments.map(d => d.finalTotalPaid)).toFixed(2),
    groups: groups(purchase).map(lines => {
      const quantity = lines.reduce((n, l) => n + l.quantity, 0);
      const pendingQuantity = lines.filter(l => !l.receivedAt).reduce((n, l) => n + l.quantity, 0);
      const total = sum(lines.map(l => l.finalLineCost));
      const listing = lines[0].productListing;
      const consistent = listing !== null && lines.every(l => l.productListingId === listing.id);
      return {
        id: lines[0].id, sourceItemIds: lines.map(l => l.id),
        description: lines[0].sourceDescription, externalProductId: lines[0].externalProductId,
        sourceSetNumber: lines.every(l => l.sourceSetNumber === lines[0].sourceSetNumber) ? lines[0].sourceSetNumber : null,
        quantity, pendingQuantity, totalCost: total.toFixed(2),
        unitCost: total.div(quantity).toFixed(6),
        costKind: lines.every(l => l.finalLineCost.div(l.quantity).equals(lines[0].finalLineCost.div(lines[0].quantity))) ? "UNIT" : "WEIGHTED_AVERAGE",
        listing: consistent ? { id: listing.id, condition: listing.condition, active: listing.active, ...listing.legoProduct } : null,
        state: lines.every(l => l.receivedAt !== null) ? "RECEIVED" : consistent ? "MATCHED" : "UNRESOLVED",
        canResolve: lines.every(l => l.receivedAt === null),
        lines: lines.map(l => {
          const doc = purchase.purchaseDocuments.find(d => d.id === l.purchaseDocumentId)!;
          return { ...l, canAmend: l.receivedAt === null,
            canAmendCost: doc.purchaseItems.every(i => i.receivedAt === null) && l.originalGrossUnitCost.mul(l.quantity).equals(l.originalGrossLineTotal) };
        }),
      };
    }),
  };
}
export async function getPurchaseReview(userId: number, purchaseId: number) {
  return prisma.$transaction(async tx => {
    await lockPurchase(tx, purchaseId);
    return represent(await readPurchase(tx, userId, purchaseId));
  });
}
async function mutate(userId: number, purchaseId: number, revision: string, action: (tx: Prisma.TransactionClient, purchase: ReviewPurchase) => Promise<void>) {
  return prisma.$transaction(async tx => {
    await lockPurchase(tx, purchaseId);
    const purchase = await readPurchase(tx, userId, purchaseId);
    if (represent(purchase).revision !== revision) throw new ReviewError(409, "Purchase changed. Refresh and review it before continuing.");
    await action(tx, purchase);
    return represent(await readPurchase(tx, userId, purchaseId));
  });
}
function findGroup(purchase: ReviewPurchase, groupId: number) {
  const group = groups(purchase).find(lines => lines[0].id === groupId);
  if (!group) throw new ReviewError(404, "Review item not found");
  return group;
}
export async function resolveReviewGroup(userId: number, purchaseId: number, groupId: number, input: unknown) {
  const body = resolutionSchema.parse(input);
  return mutate(userId, purchaseId, body.revision, async (tx, purchase) => {
    const lines = findGroup(purchase, groupId);
    if (lines.some(l => l.receivedAt)) throw new ReviewError(409, "Received items cannot be reassigned");
    if (body.productListingId !== null && !await tx.productListing.findUnique({ where: { id: body.productListingId, active: true } }))
      throw new ReviewError(400, "Select an existing active product listing");
    const changed = await tx.purchaseItem.updateMany({
      where: { id: { in: lines.map(l => l.id) }, receivedAt: null },
      data: { productListingId: body.productListingId },
    });
    if (changed.count !== lines.length) throw new ReviewError(409, "Purchase changed. Refresh before resolving.");
  });
}
export async function receiveReviewGroup(userId: number, purchaseId: number, groupId: number, input: unknown) {
  const body = revisionSchema.parse(input);
  try { return await mutate(userId, purchaseId, body.revision, async (tx, purchase) => {
    const lines = findGroup(purchase, groupId);
    const listing = lines[0].productListing;
    if (!listing?.active || lines.some(l => l.productListingId !== listing.id)) throw new ReviewError(400, "Resolve all source lines to one active listing before receiving");
    const pending = lines.filter(l => !l.receivedAt);
    if (!pending.length) throw new ReviewError(409, "Purchase item already received");
    for (const line of pending) await receivePurchaseItemInTransaction(tx, userId, line.id);
  }); } catch (error) {
    if (error instanceof UsedOfferPurchaseReceiptError) throw new ReviewError(409, error.message);
    throw error;
  }
}
export async function amendReviewLine(userId: number, purchaseId: number, itemId: number, input: unknown) {
  const body = amendmentSchema.parse(input);
  return mutate(userId, purchaseId, body.revision, async (tx, purchase) => {
    const doc = purchase.purchaseDocuments.find(d => d.purchaseItems.some(l => l.id === itemId));
    const item = doc?.purchaseItems.find(l => l.id === itemId);
    if (!doc || !item) throw new ReviewError(404, "Purchase item not found");
    if (item.receivedAt) throw new ReviewError(409, "Received items cannot be amended");
    const changesCost = (body.quantity !== undefined && body.quantity !== item.quantity) ||
      (body.originalGrossUnitCost !== undefined && !item.originalGrossUnitCost.equals(body.originalGrossUnitCost));
    if (changesCost && (doc.purchaseItems.some(l => l.receivedAt) || !item.originalGrossUnitCost.mul(item.quantity).equals(item.originalGrossLineTotal)))
      throw new ReviewError(409, "Cost changes require a wholly unreceived document and a line total equal to quantity × unit price");
    if (changesCost) {
      const items = doc.purchaseItems.map(l => {
        const quantity = l.id === itemId ? body.quantity ?? l.quantity : l.quantity;
        const unit = l.id === itemId ? new Prisma.Decimal(body.originalGrossUnitCost ?? l.originalGrossUnitCost) : l.originalGrossUnitCost;
        return { sourceDescription: l.sourceDescription, quantity, originalGrossUnitCost: unit.mul(100).toNumber(),
          originalGrossLineTotal: (l.id === itemId ? unit.mul(quantity) : l.originalGrossLineTotal).mul(100).toNumber() };
      });
      const merchandise = items.reduce((s, l) => s + l.originalGrossLineTotal, 0);
      const shipping = doc.shippingTotal.mul(100).toNumber(), discount = doc.discountTotal.mul(100).toNumber();
      if (merchandise > 999999999999 || merchandise + shipping - discount > 999999999999)
        throw new ReviewError(400, "Amended total exceeds the supported purchase amount");
      const calculated = calculatePurchaseCosts({
        importHash: doc.importHash, sourceOrderReference: purchase.sourceOrderReference,
        originalGrossMerchandiseTotal: merchandise, shippingTotal: shipping, discountTotal: discount,
        finalTotalPaid: merchandise + shipping - discount, items,
      });
      const decimal = (pence: number) => new Prisma.Decimal(pence).div(100);
      for (const [index, line] of calculated.items.entries()) {
        await tx.purchaseItem.update({ where: { id: doc.purchaseItems[index].id }, data: {
          quantity: line.quantity, originalGrossUnitCost: decimal(line.originalGrossUnitCost),
          originalGrossLineTotal: decimal(line.originalGrossLineTotal), allocatedShipping: decimal(line.allocatedShipping),
          allocatedDiscount: decimal(line.allocatedDiscount), finalLineCost: decimal(line.finalLineCost), finalUnitCost: line.finalUnitCost,
        } });
      }
      await tx.purchaseDocument.update({ where: { id: doc.id }, data: {
        originalGrossMerchandiseTotal: decimal(merchandise), finalTotalPaid: decimal(calculated.finalTotalPaid),
      } });
    }
    const changed = await tx.purchaseItem.updateMany({ where: { id: item.id, receivedAt: null }, data: {
      sourceDescription: body.sourceDescription, sourceSetNumber: body.sourceSetNumber,
      // A changed identity requires human resolution again.
      ...(body.sourceSetNumber !== item.sourceSetNumber ? { productListingId: null } : {}),
    } });
    if (changed.count !== 1) throw new ReviewError(409, "Purchase changed");
  });
}
