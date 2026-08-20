import { prisma } from "../prisma/runtime.js";
import type { Prisma } from "../generated/prisma-client/client.js";

/**
 * Match a purchase item to an internal product listing ID using the
 * `sourceSetNumber` (e.g. a LEGO set number). The matcher is deliberately
 * conservative – it only returns a listing ID when **exactly one** match is
 * found. This avoids accidental wrong associations when the source data is
 * ambiguous.
 *
 * @param sourceSetNumber A string containing the external set number or
 *                        `null`/`undefined` if not provided.
 * @returns The matching product listing ID or `null` if no unique match
 *          exists.
 */
export async function matchProductListingId(
  sourceSetNumber: string | null | undefined,
  tx?: Prisma.TransactionClient,
): Promise<number | null> {
  if (!sourceSetNumber) {
    return null;
  }

  // Find the Lego product by set number
  const client = tx ?? prisma;
  const legoProduct = await client.legoProduct.findUnique({
    where: { setNumber: sourceSetNumber },
    select: { id: true },
  });
  if (!legoProduct) {
    return null;
  }

  // Find all listings for that product – there may be several by condition
  const listings = await client.productListing.findMany({
    where: { legoProductId: legoProduct.id },
    select: { id: true },
  });

  if (listings.length !== 1) {
    return null;
  }
  return listings[0].id;
}
