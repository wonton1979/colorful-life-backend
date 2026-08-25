-- CreateEnum
CREATE TYPE "CancellationInitiator" AS ENUM ('CUSTOMER', 'SELLER');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('CHANGED_MIND', 'ORDERED_BY_MISTAKE', 'ADDRESS_PROBLEM', 'FOUND_CHEAPER_ELSEWHERE', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "OrderStatus" ADD VALUE 'DISPATCHED';
ALTER TYPE "OrderStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "OrderStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "OrderStatus" ADD VALUE 'RETURNED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancellationReason" "CancellationReason",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" "CancellationInitiator";
