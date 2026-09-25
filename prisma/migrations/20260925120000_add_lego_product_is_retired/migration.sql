-- Retirement is manually managed metadata shared by all offers for a LEGO set.
-- The default safely initializes existing products without changing inventory.
ALTER TABLE "LegoProduct" ADD COLUMN "isRetired" BOOLEAN NOT NULL DEFAULT false;
