-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CancellationReason" ADD VALUE 'OUT_OF_STOCK';
ALTER TYPE "CancellationReason" ADD VALUE 'PRICING_ERROR';
ALTER TYPE "CancellationReason" ADD VALUE 'PRODUCT_UNAVAILABLE';
ALTER TYPE "CancellationReason" ADD VALUE 'FULFILMENT_ISSUE';
