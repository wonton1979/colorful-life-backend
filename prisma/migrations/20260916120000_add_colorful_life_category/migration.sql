-- CreateEnum
CREATE TYPE "ColorfulLifeCategory" AS ENUM (
    'HARRY_POTTER',
    'STAR_WARS',
    'FRIENDS',
    'CITY',
    'DISNEY',
    'MARVEL',
    'JURASSIC_WORLD',
    'FLOWERS_AND_BOTANICALS',
    'NINJAGO',
    'HEROES',
    'VEHICLES',
    'CREATOR',
    'OTHERS'
);

-- Add nullable during the data backfill, then enforce the final invariant.
ALTER TABLE "ProductListing"
ADD COLUMN "colorfulLifeCategory" "ColorfulLifeCategory";

UPDATE "ProductListing" AS listing
SET "colorfulLifeCategory" = 'VEHICLES'
FROM "LegoProduct" AS product
WHERE listing."legoProductId" = product."id"
  AND product."setNumber" IN ('77256', '77245');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ProductListing" WHERE "colorfulLifeCategory" IS NULL) THEN
    RAISE EXCEPTION 'Cannot enforce ProductListing.colorfulLifeCategory: unmapped listings remain';
  END IF;
END $$;

ALTER TABLE "ProductListing"
ALTER COLUMN "colorfulLifeCategory" SET NOT NULL;

CREATE INDEX "ProductListing_colorfulLifeCategory_idx"
ON "ProductListing"("colorfulLifeCategory");
