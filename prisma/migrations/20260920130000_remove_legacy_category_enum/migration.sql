DROP INDEX IF EXISTS "ProductListing_one_feature_per_category_idx";
DROP INDEX IF EXISTS "ProductListing_colorfulLifeCategory_idx";

ALTER TABLE "ProductListing" DROP COLUMN "colorfulLifeCategory";
DROP TYPE "ColorfulLifeCategory";

-- Category now belongs to LegoProduct, so the old cross-column unique index
-- cannot express the invariant. This trigger provides database-level checking
-- without denormalising categoryId back onto ProductListing. Application
-- feature selection also takes the same transaction-scoped advisory lock.
CREATE FUNCTION "ensure_one_featured_listing_per_category"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  category_id INTEGER;
  existing_listing_id INTEGER;
BEGIN
  IF NEW."isFeatureProduct" IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT lp."categoryId" INTO category_id
  FROM "LegoProduct" lp
  WHERE lp."id" = NEW."legoProductId";

  IF category_id IS NULL THEN
    RAISE EXCEPTION 'Featured listing requires a Category';
  END IF;

  PERFORM pg_advisory_xact_lock(category_id);

  SELECT pl."id" INTO existing_listing_id
  FROM "ProductListing" pl
  JOIN "LegoProduct" lp ON lp."id" = pl."legoProductId"
  WHERE lp."categoryId" = category_id
    AND pl."isFeatureProduct" IS TRUE
    AND pl."id" <> NEW."id"
  LIMIT 1;

  IF existing_listing_id IS NOT NULL THEN
    RAISE EXCEPTION 'A featured listing already exists for Category %', category_id
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProductListing_one_feature_per_category_trigger"
BEFORE INSERT OR UPDATE OF "isFeatureProduct", "legoProductId"
ON "ProductListing"
FOR EACH ROW
EXECUTE FUNCTION "ensure_one_featured_listing_per_category"();
