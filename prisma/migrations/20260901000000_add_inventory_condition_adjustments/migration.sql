-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'CONDITION_ADJUSTMENT_SOURCE';
ALTER TYPE "InventoryMovementType" ADD VALUE 'CONDITION_ADJUSTMENT_TARGET';
ALTER TYPE "InventoryMovementType" ADD VALUE 'WRITE_OFF';

-- CreateEnum
CREATE TYPE "InventoryAuditAction" AS ENUM ('CONDITION_ADJUSTMENT', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "InventoryAdjustmentReason" AS ENUM (
    'CUSTOMER_RETURN_DAMAGED',
    'OPENED_BOX',
    'PACKAGING_DAMAGE',
    'MISSING_PARTS',
    'WAREHOUSE_DAMAGE',
    'QUALITY_ISSUE',
    'OTHER'
);

-- CreateTable
CREATE TABLE "InventoryAudit" (
    "id" SERIAL NOT NULL,
    "sourceProductListingId" INTEGER NOT NULL,
    "targetProductListingId" INTEGER,
    "action" "InventoryAuditAction" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" "InventoryAdjustmentReason" NOT NULL,
    "reasonNote" TEXT,
    "performedByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryAudit_sourceProductListingId_idx" ON "InventoryAudit"("sourceProductListingId");

-- CreateIndex
CREATE INDEX "InventoryAudit_targetProductListingId_idx" ON "InventoryAudit"("targetProductListingId");

-- CreateIndex
CREATE INDEX "InventoryAudit_performedByUserId_idx" ON "InventoryAudit"("performedByUserId");

-- CreateIndex
CREATE INDEX "InventoryAudit_createdAt_idx" ON "InventoryAudit"("createdAt");

-- AddForeignKey
ALTER TABLE "InventoryAudit" ADD CONSTRAINT "InventoryAudit_sourceProductListingId_fkey" FOREIGN KEY ("sourceProductListingId") REFERENCES "ProductListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAudit" ADD CONSTRAINT "InventoryAudit_targetProductListingId_fkey" FOREIGN KEY ("targetProductListingId") REFERENCES "ProductListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAudit" ADD CONSTRAINT "InventoryAudit_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
