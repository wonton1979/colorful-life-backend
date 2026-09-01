-- AlterTable
ALTER TABLE "ProductListing" ADD COLUMN "reservedStock" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "reservationExpiresAt" TIMESTAMP(3);

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'EXPIRED';
