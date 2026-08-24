-- Migration: Add isDefaultBilling to Address
ALTER TABLE "Address"
ADD COLUMN "isDefaultBilling" BOOLEAN NOT NULL DEFAULT false;