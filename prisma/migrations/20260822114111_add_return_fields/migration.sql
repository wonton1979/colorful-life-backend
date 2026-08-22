-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'PURCHASE_RETURN_OUT';

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN     "returnedAt" TIMESTAMP(3);
