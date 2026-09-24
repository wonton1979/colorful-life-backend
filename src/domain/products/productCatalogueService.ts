import { Prisma } from "../../generated/prisma-client/client.js";
import { prisma } from "../../prisma/runtime.js";
import type { ProductCatalogueQuery } from "./productCatalogueValidator.js";

const offerSelect = {
  id: true, legoProductId: true, catalogueArtworkUrl: true, catalogueArtworkPublicId: true, isFeatureProduct: true,
  active: true, condition: true, usedLifecycle: true, damageDescription: true, originalPrice: true,
  salePrice: true, currentStock: true, reservedStock: true, listingImages: { orderBy: { sortOrder: "asc" as const } },
  usedConditionPhotos: { orderBy: { sortOrder: "asc" as const } },
};

function eligibleProductPredicate(query: ProductCatalogueQuery): Prisma.Sql {
  const predicates: Prisma.Sql[] = [];
  if (query.q) predicates.push(Prisma.sql`(
    strpos(lower(lp."setNumber"), lower(${query.q})) > 0 OR
    strpos(lower(lp."title"), lower(${query.q})) > 0
  )`);
  if (query.theme) predicates.push(Prisma.sql`lower(lp."theme") = lower(${query.theme})`);
  if (query.categoryId !== undefined) predicates.push(Prisma.sql`lp."categoryId" = ${query.categoryId}`);

  const pricePredicates: Prisma.Sql[] = [];
  if (query.minPrice !== undefined) pricePredicates.push(Prisma.sql`COALESCE(pl."salePrice", pl."originalPrice") >= ${query.minPrice}`);
  if (query.maxPrice !== undefined) pricePredicates.push(Prisma.sql`COALESCE(pl."salePrice", pl."originalPrice") <= ${query.maxPrice}`);
  const pricePredicate = pricePredicates.length ? Prisma.sql`AND ${Prisma.join(pricePredicates, " AND ")}` : Prisma.empty;

  predicates.push(Prisma.sql`EXISTS (
    SELECT 1 FROM "ProductListing" pl
    WHERE pl."legoProductId" = lp."id"
      AND pl."active" = TRUE
      AND pl."currentStock" > pl."reservedStock"
      AND (pl."condition" = 'NEW' OR (pl."condition" = 'USED_LIKE_NEW' AND pl."usedLifecycle" = 'AVAILABLE'))
      ${pricePredicate}
  )`);
  return Prisma.join(predicates, " AND ");
}

function offerMatchesQuery(listing: any, query: ProductCatalogueQuery) {
  if (!listing.active || listing.currentStock <= listing.reservedStock) return false;
  if (listing.condition !== "NEW" && !(listing.condition === "USED_LIKE_NEW" && listing.usedLifecycle === "AVAILABLE")) return false;
  const effectivePrice = Number(listing.salePrice ?? listing.originalPrice);
  return (query.minPrice === undefined || effectivePrice >= query.minPrice)
    && (query.maxPrice === undefined || effectivePrice <= query.maxPrice);
}

function presentProduct(product: any, query?: ProductCatalogueQuery) {
  const { category, productListings, ...shared } = product;
  const offers = productListings
    .filter((listing: any) => query ? offerMatchesQuery(listing, query) : offerMatchesQuery(listing, {} as ProductCatalogueQuery))
    .map(({ reservedStock, ...listing }: any) => ({
      ...listing,
      availableStock: Math.max(0, listing.currentStock - reservedStock),
      effectivePrice: listing.salePrice ?? listing.originalPrice,
    }));
  return {
    ...shared,
    category: category ?? null,
    isFeatureProduct: productListings.some((listing: any) => listing.isFeatureProduct),
    offers,
  };
}

export async function listCatalogueProducts(query: ProductCatalogueQuery) {
  const predicate = eligibleProductPredicate(query);
  return prisma.$transaction(async (tx) => {
    const [countRows, pageRows] = await Promise.all([
      tx.$queryRaw<Array<{ totalItems: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS "totalItems"
        FROM "LegoProduct" lp
        WHERE ${predicate}
      `),
      tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT lp."id"
        FROM "LegoProduct" lp
        WHERE ${predicate}
        ORDER BY lp."createdAt" DESC, lp."id" DESC
        OFFSET ${(query.page - 1) * query.pageSize}
        LIMIT ${query.pageSize}
      `),
    ]);
    const productIds = pageRows.map((row) => row.id);
    const products = await tx.legoProduct.findMany({
      where: { id: { in: productIds } },
      include: {
        category: { select: { id: true, name: true, subtitle: true, description: true, imageUrl: true } },
        productListings: { select: offerSelect, orderBy: [{ condition: "asc" }, { id: "asc" }] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const totalItems = Number(countRows[0]?.totalItems ?? 0n);
    return {
      items: products.map((product) => presentProduct(product, query)),
      pagination: { page: query.page, pageSize: query.pageSize, totalItems, totalPages: Math.ceil(totalItems / query.pageSize) },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function getCatalogueProductById(productId: number) {
  const product = await prisma.legoProduct.findUnique({
    where: { id: productId },
    include: {
      category: { select: { id: true, name: true, subtitle: true, description: true, imageUrl: true } },
      productListings: { select: offerSelect, orderBy: [{ condition: "asc" }, { id: "asc" }] },
    },
  });
  if (!product) return null;
  return presentProduct(product);
}
