-- CreateEnum
CREATE TYPE "BusinessExpenseCategory" AS ENUM ('PURCHASE', 'SHIPPING', 'PLATFORM_FEE', 'PACKAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "BusinessExpenseSourceType" AS ENUM ('MANUAL');

-- CreateTable
CREATE TABLE "BusinessExpense" (
    "id" SERIAL NOT NULL,
    "category" "BusinessExpenseCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "sourceType" "BusinessExpenseSourceType" NOT NULL,
    "sourceId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessExpense_pkey" PRIMARY KEY ("id")
);
