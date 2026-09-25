-- Move presentation from condition-specific offers to product identity.
-- Conflict checks run before any DDL or data changes and this migration is
-- transactional. Ambiguous legacy state requires an explicit operator decision.
BEGIN;

-- Stop/drain the old application before deployment. Fail immediately if any
-- source table is still in use; never inspect a snapshot that legacy writers
-- can change between preflight, backfill, and contraction. These locks remain
-- held through COMMIT (or ROLLBACK on any error), including across table rename.
LOCK TABLE "LegoProduct", "ProductListing", "ListingImage"
  IN ACCESS EXCLUSIVE MODE NOWAIT;

DO $$
DECLARE
  conflict_ids TEXT;
BEGIN
  SELECT string_agg(product_id::text, ', ' ORDER BY product_id)
  INTO conflict_ids
  FROM (
    SELECT "legoProductId" AS product_id
    FROM (
      SELECT DISTINCT pl."legoProductId", pl."catalogueArtworkUrl", pl."catalogueArtworkPublicId"
      FROM "ProductListing" pl
      WHERE pl."catalogueArtworkUrl" IS NOT NULL
         OR pl."catalogueArtworkPublicId" IS NOT NULL
    ) artwork_versions
    GROUP BY "legoProductId"
    HAVING COUNT(*) > 1
  ) conflicts;
  IF conflict_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Product presentation migration stopped: conflicting catalogue artwork on LegoProduct IDs %; reconcile artwork pairs before retrying', conflict_ids;
  END IF;

  SELECT string_agg(product_id::text, ', ' ORDER BY product_id)
  INTO conflict_ids
  FROM (
    SELECT DISTINCT pl."legoProductId" AS product_id
    FROM "ProductListing" pl
    WHERE pl."catalogueArtworkPublicId" IN (
      SELECT "catalogueArtworkPublicId"
      FROM "ProductListing"
      WHERE "catalogueArtworkPublicId" IS NOT NULL
      GROUP BY "catalogueArtworkPublicId"
      HAVING COUNT(DISTINCT "legoProductId") > 1
    )
  ) conflicts;
  IF conflict_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Product presentation migration stopped: catalogue artwork public IDs are shared by multiple LegoProducts including IDs %; reconcile storage ownership before retrying', conflict_ids;
  END IF;

  SELECT string_agg("legoProductId"::text, ', ' ORDER BY "legoProductId")
  INTO conflict_ids
  FROM (
    SELECT "legoProductId"
    FROM "ListingImage" li
    JOIN "ProductListing" pl ON pl."id" = li."listingId"
    GROUP BY pl."legoProductId"
    HAVING COUNT(DISTINCT pl."id") > 1
  ) conflicts;
  IF conflict_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Product presentation migration stopped: Product Images exist on multiple sibling listings for LegoProduct IDs %; reconcile image sets and ordering before retrying', conflict_ids;
  END IF;

  SELECT string_agg("legoProductId"::text, ', ' ORDER BY "legoProductId")
  INTO conflict_ids
  FROM (
    SELECT pl."legoProductId", li."publicId"
    FROM "ListingImage" li
    JOIN "ProductListing" pl ON pl."id" = li."listingId"
    GROUP BY pl."legoProductId", li."publicId"
    HAVING COUNT(*) > 1
  ) conflicts;
  IF conflict_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Product presentation migration stopped: duplicate Product Image public IDs exist for LegoProduct IDs %; reconcile duplicate asset references before retrying', conflict_ids;
  END IF;

  SELECT string_agg(DISTINCT pl."legoProductId"::text, ', ' ORDER BY pl."legoProductId"::text)
  INTO conflict_ids
  FROM "ListingImage" li
  JOIN "ProductListing" pl ON pl."id" = li."listingId"
  WHERE li."publicId" IN (
    SELECT "publicId" FROM "ListingImage" GROUP BY "publicId" HAVING COUNT(*) > 1
  );
  IF conflict_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Product presentation migration stopped: Product Image public IDs are shared across LegoProducts %; reconcile storage ownership before retrying', conflict_ids;
  END IF;

  SELECT string_agg("legoProductId"::text, ', ' ORDER BY "legoProductId")
  INTO conflict_ids
  FROM (
    SELECT pl."legoProductId", li."sortOrder"
    FROM "ListingImage" li
    JOIN "ProductListing" pl ON pl."id" = li."listingId"
    GROUP BY pl."legoProductId", li."sortOrder"
    HAVING COUNT(*) > 1
  ) conflicts;
  IF conflict_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Product presentation migration stopped: duplicate Product Image sort orders exist for LegoProduct IDs %; reconcile ordering before retrying', conflict_ids;
  END IF;

  SELECT string_agg(lp."id"::text, ', ' ORDER BY lp."id")
  INTO conflict_ids
  FROM "LegoProduct" lp
  WHERE lp."categoryId" IS NULL
    AND EXISTS (
      SELECT 1 FROM "ProductListing" pl
      WHERE pl."legoProductId" = lp."id" AND pl."isFeatureProduct" IS TRUE
    );
  IF conflict_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Product presentation migration stopped: featured LegoProduct IDs % have no Category; assign a Category or clear legacy Feature state before retrying', conflict_ids;
  END IF;

  SELECT string_agg(category_id::text, ', ' ORDER BY category_id)
  INTO conflict_ids
  FROM (
    SELECT lp."categoryId" AS category_id, COUNT(DISTINCT lp."id") AS product_count
    FROM "LegoProduct" lp
    JOIN "ProductListing" pl ON pl."legoProductId" = lp."id"
    WHERE pl."isFeatureProduct" IS TRUE
    GROUP BY lp."categoryId"
    HAVING COUNT(DISTINCT lp."id") > 1
  ) conflicts;
  IF conflict_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Product presentation migration stopped: conflicting featured products exist in Category IDs %; reconcile Feature selection before retrying', conflict_ids;
  END IF;
END $$;

ALTER TABLE "LegoProduct"
  ADD COLUMN "catalogueArtworkUrl" TEXT,
  ADD COLUMN "catalogueArtworkPublicId" TEXT,
  ADD COLUMN "isFeatureProduct" BOOLEAN NOT NULL DEFAULT false;

UPDATE "LegoProduct" lp
SET "catalogueArtworkUrl" = (
      SELECT pl."catalogueArtworkUrl" FROM "ProductListing" pl
      WHERE pl."legoProductId" = lp."id"
        AND (pl."catalogueArtworkUrl" IS NOT NULL OR pl."catalogueArtworkPublicId" IS NOT NULL)
      ORDER BY pl."id" ASC LIMIT 1
    ),
    "catalogueArtworkPublicId" = (
      SELECT pl."catalogueArtworkPublicId" FROM "ProductListing" pl
      WHERE pl."legoProductId" = lp."id"
        AND (pl."catalogueArtworkUrl" IS NOT NULL OR pl."catalogueArtworkPublicId" IS NOT NULL)
      ORDER BY pl."id" ASC LIMIT 1
    ),
    "isFeatureProduct" = EXISTS (
      SELECT 1 FROM "ProductListing" pl
      WHERE pl."legoProductId" = lp."id" AND pl."isFeatureProduct" IS TRUE
    );

-- Preserve ProductImage row IDs, URLs, alt text, ordering, and storage IDs.
ALTER TABLE "ListingImage" ADD COLUMN "legoProductId" INTEGER;
UPDATE "ListingImage" li
SET "legoProductId" = pl."legoProductId"
FROM "ProductListing" pl
WHERE pl."id" = li."listingId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ListingImage" WHERE "legoProductId" IS NULL) THEN
    RAISE EXCEPTION 'Product presentation migration stopped: a ListingImage has no owning LegoProduct';
  END IF;
END $$;

DROP TRIGGER IF EXISTS "ProductListing_one_feature_per_category_trigger" ON "ProductListing";
DROP FUNCTION IF EXISTS "ensure_one_featured_listing_per_category"();
DROP INDEX IF EXISTS "ProductListing_one_feature_per_category_idx";

DROP INDEX "ListingImage_listingId_idx";
DROP INDEX "ListingImage_listingId_sortOrder_idx";
ALTER TABLE "ListingImage" DROP CONSTRAINT "ListingImage_listingId_fkey";
ALTER TABLE "ListingImage" DROP COLUMN "listingId";
ALTER TABLE "ListingImage" ALTER COLUMN "legoProductId" SET NOT NULL;
ALTER TABLE "ListingImage" RENAME TO "ProductImage";
ALTER TABLE "ProductImage" RENAME CONSTRAINT "ListingImage_pkey" TO "ProductImage_pkey";
ALTER SEQUENCE "ListingImage_id_seq" RENAME TO "ProductImage_id_seq";
ALTER TABLE "ProductImage" ALTER COLUMN "id" SET DEFAULT nextval('"ProductImage_id_seq"'::regclass);
SELECT setval('"ProductImage_id_seq"'::regclass, COALESCE(MAX("id"), 1), MAX("id") IS NOT NULL)
FROM "ProductImage";
ALTER TABLE "ProductImage"
  ADD CONSTRAINT "ProductImage_legoProductId_fkey"
  FOREIGN KEY ("legoProductId") REFERENCES "LegoProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ProductImage_legoProductId_idx" ON "ProductImage"("legoProductId");
CREATE INDEX "ProductImage_legoProductId_sortOrder_idx" ON "ProductImage"("legoProductId", "sortOrder");

ALTER TABLE "ProductListing"
  DROP COLUMN "catalogueArtworkUrl",
  DROP COLUMN "catalogueArtworkPublicId",
  DROP COLUMN "isFeatureProduct";

CREATE UNIQUE INDEX "LegoProduct_one_feature_per_category_idx"
  ON "LegoProduct"("categoryId")
  WHERE "isFeatureProduct" IS TRUE;

-- Declarative constraints protect direct SQL/Prisma writes too. Do not take
-- category advisory locks in a row trigger: UPDATE already owns a row lock,
-- whereas application Feature selection takes the category lock first.
ALTER TABLE "LegoProduct"
  ADD CONSTRAINT "LegoProduct_feature_requires_category_check"
  CHECK (NOT "isFeatureProduct" OR "categoryId" IS NOT NULL);

COMMIT;
