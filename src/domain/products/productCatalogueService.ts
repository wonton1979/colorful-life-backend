import { Prisma } from "../../generated/prisma-client/client.js";
import { prisma } from "../../prisma/runtime.js";
import type { ProductCatalogueQuery } from "./productCatalogueValidator.js";

const listingSelect = {
  id: true,
  legoProductId: true,
  condition: true,
  originalPrice: true,
  salePrice: true,
  currentStock: true,
  createdAt: true,
  updatedAt: true,
  legoProduct: true,
  listingImages: { orderBy: { sortOrder: "asc" as const } },
};

export async function listCatalogueProducts(query: ProductCatalogueQuery) {
  const and: Prisma.ProductListingWhereInput[] = [{ active: true }];
  if (query.q) {
    and.push({ legoProduct: { OR: [
      { setNumber: { contains: query.q, mode: "insensitive" } },
      { title: { contains: query.q, mode: "insensitive" } },
    ] } });
  }
  if (query.theme) {
    and.push({ legoProduct: { theme: { equals: query.theme, mode: "insensitive" } } });
  }
  const price: Prisma.ProductListingWhereInput[] = [];
  if (query.minPrice !== undefined) price.push({ OR: [
    { salePrice: { gte: query.minPrice } },
    { salePrice: null, originalPrice: { gte: query.minPrice } },
  ] });
  if (query.maxPrice !== undefined) price.push({ OR: [
    { salePrice: { lte: query.maxPrice } },
    { salePrice: null, originalPrice: { lte: query.maxPrice } },
  ] });
  and.push(...price);
  const where: Prisma.ProductListingWhereInput = { AND: and };
  const [totalItems, items] = await prisma.$transaction([
    prisma.productListing.count({ where }),
    prisma.productListing.findMany({
      where,
      select: listingSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    items,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    },
  };
}
