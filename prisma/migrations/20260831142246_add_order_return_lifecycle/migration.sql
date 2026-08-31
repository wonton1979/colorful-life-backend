-- CreateEnum
CREATE TYPE "OrderReturnStatus" AS ENUM ('REQUESTED', 'AUTHORIZED', 'RECEIVED', 'INSPECTED', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('CHANGE_OF_MIND', 'DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'OTHER');

-- CreateEnum
CREATE TYPE "ReturnShippingPayer" AS ENUM ('CUSTOMER', 'SELLER');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('AS_NEW', 'OPENED_COMPLETE', 'DAMAGED', 'INCOMPLETE', 'WRONG_ITEM_RETURNED', 'OTHER');

-- DropIndex
DROP INDEX "OrderReturn_returnedAt_idx";

-- AlterTable
ALTER TABLE "OrderReturn"
ADD COLUMN "authorizedAt" TIMESTAMP(3),
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "condition" "ReturnCondition",
ADD COLUMN "inspectedAt" TIMESTAMP(3),
ADD COLUMN "inspectedByUserId" INTEGER,
ADD COLUMN "inspectionNote" TEXT,
ADD COLUMN "reasonNote" TEXT,
ADD COLUMN "receivedAt" TIMESTAMP(3),
ADD COLUMN "rejectedAt" TIMESTAMP(3),
ADD COLUMN "requestedAt" TIMESTAMP(3),
ADD COLUMN "restockQuantity" INTEGER,
ADD COLUMN "returnShippingCost" DECIMAL(10,2),
ADD COLUMN "shippingPayer" "ReturnShippingPayer",
ADD COLUMN "status" "OrderReturnStatus",
ADD COLUMN "reason_new" "ReturnReason";

UPDATE "OrderReturn"
SET
    "status" = 'COMPLETED',
    "restockQuantity" = "quantity",
    "requestedAt" = "returnedAt",
    "receivedAt" = "returnedAt",
    "completedAt" = "returnedAt",
    "reason_new" = CASE "reason"
        WHEN 'CHANGE_OF_MIND' THEN 'CHANGE_OF_MIND'::"ReturnReason"
        WHEN 'DAMAGED' THEN 'DAMAGED'::"ReturnReason"
        WHEN 'DEFECTIVE' THEN 'DEFECTIVE'::"ReturnReason"
        WHEN 'WRONG_ITEM' THEN 'WRONG_ITEM'::"ReturnReason"
        WHEN 'NOT_AS_DESCRIBED' THEN 'NOT_AS_DESCRIBED'::"ReturnReason"
        WHEN 'OTHER' THEN 'OTHER'::"ReturnReason"
        ELSE 'OTHER'::"ReturnReason"
    END
WHERE "reason" IS NOT NULL;

UPDATE "OrderReturn"
SET "reasonNote" = "reason"
WHERE "reason" NOT IN (
    'CHANGE_OF_MIND',
    'DAMAGED',
    'DEFECTIVE',
    'WRONG_ITEM',
    'NOT_AS_DESCRIBED',
    'OTHER'
);

ALTER TABLE "OrderReturn"
DROP COLUMN "reason";

ALTER TABLE "OrderReturn"
RENAME COLUMN "reason_new" TO "reason";

ALTER TABLE "OrderReturn"
ALTER COLUMN "restockQuantity" SET DEFAULT 0,
ALTER COLUMN "restockQuantity" SET NOT NULL,
ALTER COLUMN "reason" SET NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'REQUESTED',
ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "requestedAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "requestedAt" SET NOT NULL;

ALTER TABLE "OrderReturn"
DROP COLUMN "returnedAt";

-- CreateIndex
CREATE INDEX "OrderReturn_status_idx" ON "OrderReturn"("status");

-- CreateIndex
CREATE INDEX "OrderReturn_inspectedByUserId_idx" ON "OrderReturn"("inspectedByUserId");

-- CreateIndex
CREATE INDEX "OrderReturn_requestedAt_idx" ON "OrderReturn"("requestedAt");

-- AddForeignKey
ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_inspectedByUserId_fkey" FOREIGN KEY ("inspectedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
