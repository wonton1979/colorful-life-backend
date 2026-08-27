-- Migration: Add shipping dispatch fields to Order table
ALTER TABLE "Order"
  ADD COLUMN "actualShippingCost" DECIMAL(10,2),
  ADD COLUMN "shippingCarrier" TEXT,
  ADD COLUMN "trackingNumber" TEXT,
  ADD COLUMN "dispatchedAt" TIMESTAMP(3);