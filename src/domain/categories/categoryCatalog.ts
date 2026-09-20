import { prisma } from "../../prisma/runtime.js";

export async function listCategories() {
  return prisma.category.findMany({
    orderBy: { id: "asc" },
    select: { id: true, name: true, subtitle: true, description: true, imageUrl: true },
  });
}
