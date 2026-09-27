import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma-client/client.js";
import { prisma } from "../../prisma/runtime.js";

type SupplierSpendRow = {
  merchantName: string | null;
  totalAmount: string;
  documentCount: number;
};

type SupplierMonthSpendRow = {
  merchantName: string | null;
  month: string | null;
  totalAmount: string;
  documentCount: number;
};

type SupplierGroup = {
  supplierKey: string;
  supplierName: string;
  totalAmount: Prisma.Decimal;
};

export class PurchaseAnalyticsSupplierNotFoundError extends Error {
  constructor() {
    super("Supplier not found");
    this.name = "PurchaseAnalyticsSupplierNotFoundError";
  }
}

export class InvalidPurchaseAnalyticsSupplierKeyError extends Error {
  constructor() {
    super("Invalid supplier key");
    this.name = "InvalidPurchaseAnalyticsSupplierKeyError";
  }
}

function canonicalSupplierName(name: string | null): string {
  return name?.trim().toLowerCase() ?? "";
}

function supplierKey(canonicalName: string): string {
  if (!canonicalName) return "unknown";
  const digest = createHash("sha256").update(canonicalName, "utf8").digest("hex");
  return `supplier-${digest}`;
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function buildSupplierGroups(rows: SupplierSpendRow[]): SupplierGroup[] {
  const groups = new Map<string, { displayNames: Map<string, number>; totalAmount: Prisma.Decimal }>();

  for (const row of rows) {
    const canonicalName = canonicalSupplierName(row.merchantName);
    const group = groups.get(canonicalName) ?? {
      displayNames: new Map<string, number>(),
      totalAmount: new Prisma.Decimal(0),
    };
    const displayName = row.merchantName?.trim();
    if (displayName) group.displayNames.set(displayName, row.documentCount);
    group.totalAmount = group.totalAmount.plus(row.totalAmount);
    groups.set(canonicalName, group);
  }

  return [...groups.entries()].map(([canonicalName, group]) => {
    const displayName = [...group.displayNames.entries()]
      .sort(([leftName, leftCount], [rightName, rightCount]) => rightCount - leftCount || compareNames(leftName, rightName))[0]?.[0];
    return {
      supplierKey: supplierKey(canonicalName),
      supplierName: displayName ?? "Unknown supplier",
      totalAmount: group.totalAmount,
    };
  });
}

function amountString(value: Prisma.Decimal | null): string {
  return (value ?? new Prisma.Decimal(0)).toFixed(2);
}

export function serializePurchaseAnalyticsSummary(
  totalQuantity: number | null,
  totalAmount: Prisma.Decimal | null,
  supplierRows: SupplierSpendRow[],
) {
  const suppliers = buildSupplierGroups(supplierRows);
  suppliers.sort((left, right) => {
    const amountOrder = right.totalAmount.comparedTo(left.totalAmount);
    return amountOrder || compareNames(left.supplierKey, right.supplierKey);
  });

  return {
    totalQuantity: totalQuantity ?? 0,
    totalAmount: amountString(totalAmount),
    suppliers: suppliers.map((supplier) => ({
      supplierKey: supplier.supplierKey,
      supplierName: supplier.supplierName,
      totalAmount: supplier.totalAmount.toFixed(2),
    })),
  };
}

/** Company-wide purchase summary. Documents and items are aggregated separately. */
export async function getPurchaseAnalyticsSummary() {
  return prisma.$transaction(async (tx) => {
    const [documentTotals, itemTotals, supplierRows] = await Promise.all([
      tx.purchaseDocument.aggregate({ _sum: { finalTotalPaid: true } }),
      tx.purchaseItem.aggregate({
        where: { inventoryDisposition: "INVENTORY" },
        _sum: { quantity: true },
      }),
      tx.$queryRaw<SupplierSpendRow[]>`
        SELECT p."merchantName" AS "merchantName",
               SUM(pd."finalTotalPaid")::text AS "totalAmount",
               COUNT(pd."id")::integer AS "documentCount"
          FROM "PurchaseDocument" AS pd
          INNER JOIN "Purchase" AS p ON p."id" = pd."purchaseId"
         GROUP BY p."merchantName"
        `,
    ]);

    // Each document contributes once to spend; only inventory-designated item
    // quantities count as inventory units. Excluded lines remain in document spend.
    return serializePurchaseAnalyticsSummary(
      itemTotals._sum.quantity,
      documentTotals._sum.finalTotalPaid,
      supplierRows,
    );
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

const supplierKeyPattern = /^supplier-[a-f0-9]{64}$/;

/** Monthly document spend for one normalized merchant name. */
export async function getSupplierMonthlyPurchaseAnalytics(requestedKey: string) {
  if (requestedKey !== "unknown" && !supplierKeyPattern.test(requestedKey)) {
    throw new InvalidPurchaseAnalyticsSupplierKeyError();
  }

  return prisma.$transaction(async (tx) => {
    const merchantRows = await tx.$queryRaw<Array<{ merchantName: string | null }>>`
      SELECT DISTINCT p."merchantName" AS "merchantName"
      FROM "Purchase" AS p
      WHERE EXISTS (
        SELECT 1 FROM "PurchaseDocument" AS pd WHERE pd."purchaseId" = p."id"
      )
    `;
    const matchingMerchants = merchantRows
      .filter((row) => supplierKey(canonicalSupplierName(row.merchantName)) === requestedKey)
      .map((row) => row.merchantName);
    if (!matchingMerchants.length) throw new PurchaseAnalyticsSupplierNotFoundError();

    const merchantNames = matchingMerchants.filter((name): name is string => name !== null);
    const hasNullMerchant = matchingMerchants.includes(null);
    const predicates = [
      ...(merchantNames.length
        ? [Prisma.sql`p."merchantName" IN (${Prisma.join(merchantNames)})`]
        : []),
      ...(hasNullMerchant ? [Prisma.sql`p."merchantName" IS NULL`] : []),
    ];

    const rows = await tx.$queryRaw<SupplierMonthSpendRow[]>`
      SELECT matched."merchantName" AS "merchantName",
             CASE WHEN matched."monthDate" IS NULL THEN NULL
                  ELSE TO_CHAR(matched."monthDate", 'YYYY-MM')
             END AS "month",
             SUM(matched."finalTotalPaid")::text AS "totalAmount",
             COUNT(*)::integer AS "documentCount"
      FROM (
        SELECT p."merchantName" AS "merchantName",
               DATE_TRUNC('month', p."sourceOrderDate") AS "monthDate",
               pd."finalTotalPaid" AS "finalTotalPaid"
        FROM "PurchaseDocument" AS pd
        INNER JOIN "Purchase" AS p ON p."id" = pd."purchaseId"
        WHERE (${Prisma.join(predicates, " OR ")})
      ) AS matched
      GROUP BY matched."merchantName", matched."monthDate"
    `;

    const nameCounts = new Map<string, number>();
    const monthTotals = new Map<string, Prisma.Decimal>();
    let undatedTotal = new Prisma.Decimal(0);
    for (const row of rows) {
      const trimmed = row.merchantName?.trim();
      if (trimmed) nameCounts.set(trimmed, (nameCounts.get(trimmed) ?? 0) + row.documentCount);
      if (row.month === null) {
        undatedTotal = undatedTotal.plus(row.totalAmount);
      } else {
        monthTotals.set(row.month, (monthTotals.get(row.month) ?? new Prisma.Decimal(0)).plus(row.totalAmount));
      }
    }

    return {
      supplierKey: requestedKey,
      supplierName: [...nameCounts.entries()]
        .sort(([leftName, leftCount], [rightName, rightCount]) => rightCount - leftCount || compareNames(leftName, rightName))[0]?.[0]
        ?? "Unknown supplier",
      months: [...monthTotals.entries()]
        .sort(([left], [right]) => compareNames(right, left))
        .map(([month, total]) => ({ month, totalAmount: total.toFixed(2) })),
      undatedTotalAmount: undatedTotal.toFixed(2),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
