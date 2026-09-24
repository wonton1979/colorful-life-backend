import { prisma } from "../../prisma/runtime.js";
import { Prisma } from "../../generated/prisma-client/client.js";
import { CartItemNotFoundError, InsufficientAvailableStockError, ProductListingInactiveError, ProductListingNotFoundError } from "./cartErrors.js";

const listingSelect = {
  id: true, legoProductId: true, condition: true, originalPrice: true, salePrice: true,
  currentStock: true, reservedStock: true, active: true, usedLifecycle: true, damageDescription: true, legoProduct: true,
  listingImages: { orderBy: { sortOrder: "asc" as const } },
  usedConditionPhotos: { orderBy: { sortOrder: "asc" as const } },
};

async function getOrCreateCart(userId: number) {
  return prisma.cart.upsert({ where: { userId }, create: { userId }, update: {}, include: { items: { include: { productListing: { select: listingSelect } }, orderBy: { id: "asc" } } } });
}

function present(cart: any) {
  return { ...cart, items: cart.items.map((item: any) => ({ ...item, productListing: { ...item.productListing, availableStock: Math.max(0, item.productListing.currentStock - item.productListing.reservedStock), effectivePrice: item.productListing.salePrice ?? item.productListing.originalPrice } })) };
}

export async function getCart(userId: number) { return present(await getOrCreateCart(userId)); }

async function validateListing(productListingId: number, quantity: number, db: typeof prisma | Prisma.TransactionClient = prisma) {
  const listing = await db.productListing.findUnique({ where: { id: productListingId }, select: listingSelect });
  if (!listing) throw new ProductListingNotFoundError(productListingId);
  if (!listing.active) throw new ProductListingInactiveError(productListingId);
  if (listing.condition === "USED_LIKE_NEW" && listing.usedLifecycle !== "AVAILABLE") {
    throw new InsufficientAvailableStockError(productListingId, 0, quantity);
  }
  const availableStock = listing.currentStock - listing.reservedStock;
  if (quantity > availableStock) throw new InsufficientAvailableStockError(productListingId, availableStock, quantity);
  return listing;
}

export async function addCartItem(userId: number, productListingId: number, quantity: number, retry = 0) {
  const result = await prisma.$transaction(async (tx) => {
    // Acquire the listing lock before any cart read/write so concurrent
    // transactions observe the committed result of the previous addition.
    await tx.$queryRaw`SELECT id FROM "ProductListing" WHERE id = ${productListingId} FOR UPDATE`;
    await tx.$executeRaw`INSERT INTO "Cart" ("userId", "createdAt", "updatedAt") VALUES (${userId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("userId") DO NOTHING`;
    const cart = await tx.cart.findUniqueOrThrow({ where: { userId }, select: { id: true } });

    // Re-read stock after acquiring the listing row lock.
    const listing = await tx.productListing.findUnique({ where: { id: productListingId }, select: listingSelect });
    if (!listing) throw new ProductListingNotFoundError(productListingId);
    if (!listing.active) throw new ProductListingInactiveError(productListingId);
    if (listing.condition === "USED_LIKE_NEW" && listing.usedLifecycle !== "AVAILABLE") {
      throw new InsufficientAvailableStockError(productListingId, 0, quantity);
    }

    const availableStock = listing.currentStock - listing.reservedStock;
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      INSERT INTO "CartItem" ("cartId", "productListingId", "quantity", "createdAt", "updatedAt")
      SELECT ${cart.id}, "id", ${quantity}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM "ProductListing"
      WHERE "id" = ${productListingId}
        AND "active" = TRUE
        AND ("condition" = 'NEW' OR ("condition" = 'USED_LIKE_NEW' AND "usedLifecycle" = 'AVAILABLE'))
        AND "currentStock" - "reservedStock" >= ${quantity}
      ON CONFLICT ("cartId", "productListingId") DO UPDATE
      SET "quantity" = "CartItem"."quantity" + EXCLUDED."quantity",
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "CartItem"."quantity" + EXCLUDED."quantity" <= ${availableStock}
      RETURNING id
    `;
    if (rows.length === 0) return { cartId: cart.id, itemId: null, availableStock };
    return { cartId: cart.id, itemId: rows[0].id, availableStock };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  if (result.itemId === null) {
    const currentCart = await getCart(userId);
    const current = currentCart.items.find((item: any) => item.productListingId === productListingId);
    const listing = await prisma.productListing.findUnique({ where: { id: productListingId }, select: { active: true, currentStock: true, reservedStock: true } });
    const availableStock = listing ? Math.max(0, listing.currentStock - listing.reservedStock) : 0;
    if (retry === 0 && current && listing?.active && current.quantity + quantity <= availableStock) return addCartItem(userId, productListingId, quantity, 1);
    throw new InsufficientAvailableStockError(productListingId, availableStock, (current?.quantity ?? 0) + quantity);
  }
  return getCart(userId).then((cart) => ({ ...cart, itemId: result.itemId }));
}

export async function updateCartItem(userId: number, productListingId: number, quantity: number) {
  await prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({ where: { userId }, select: { id: true } });
    if (!cart) throw new CartItemNotFoundError();
    const existing = await tx.cartItem.findUnique({ where: { cartId_productListingId: { cartId: cart.id, productListingId } }, select: { id: true } });
    if (!existing) throw new CartItemNotFoundError();
    await tx.$queryRaw`SELECT id FROM "ProductListing" WHERE id = ${productListingId} FOR UPDATE`;
    await validateListing(productListingId, quantity, tx);
    await tx.cartItem.update({ where: { id: existing.id }, data: { quantity } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return getCart(userId);
}

export async function removeCartItem(userId: number, productListingId: number) {
  const cart = await getOrCreateCart(userId);
  const existing = cart.items.find((item) => item.productListingId === productListingId);
  if (!existing) throw new CartItemNotFoundError();
  await prisma.cartItem.delete({ where: { id: existing.id } });
  return getCart(userId);
}

export async function clearCart(userId: number) {
  const cart = await getOrCreateCart(userId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  return getCart(userId);
}
