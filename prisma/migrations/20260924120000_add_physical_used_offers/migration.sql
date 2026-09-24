CREATE TYPE "UsedOfferLifecycle" AS ENUM ('AVAILABLE', 'SOLD', 'RETIRED');

ALTER TABLE "ProductListing"
  ADD COLUMN "damageDescription" TEXT,
  ADD COLUMN "usedLifecycle" "UsedOfferLifecycle";

CREATE TABLE "UsedConditionPhoto" (
  "id" SERIAL NOT NULL,
  "listingId" INTEGER NOT NULL,
  "url" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsedConditionPhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsedConditionPhoto_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "ProductListing"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UsedConditionPhoto_listingId_sortOrder_key" ON "UsedConditionPhoto"("listingId", "sortOrder");
CREATE INDEX "UsedConditionPhoto_listingId_idx" ON "UsedConditionPhoto"("listingId");

ALTER TABLE "OrderItem"
  ADD COLUMN "conditionSnapshot" "ListingCondition",
  ADD COLUMN "damageDescriptionSnapshot" TEXT,
  ADD COLUMN "conditionPhotoSnapshot" JSONB;

ALTER TABLE "ProductListing"
  ADD CONSTRAINT "ProductListing_used_stock_check"
    CHECK ("condition" <> 'USED_LIKE_NEW' OR "currentStock" BETWEEN 0 AND 1),
  ADD CONSTRAINT "ProductListing_used_lifecycle_check"
    CHECK (("condition" = 'NEW' AND "usedLifecycle" IS NULL)
        OR ("condition" = 'USED_LIKE_NEW' AND "usedLifecycle" IS NOT NULL
            AND (("usedLifecycle" = 'AVAILABLE' AND "currentStock" = 1 AND "reservedStock" BETWEEN 0 AND 1)
              OR ("usedLifecycle" IN ('SOLD', 'RETIRED') AND "currentStock" = 0 AND "reservedStock" = 0)))),
  ADD CONSTRAINT "ProductListing_used_damage_description_check"
    CHECK ("condition" <> 'USED_LIKE_NEW' OR length(btrim(COALESCE("damageDescription", ''))) > 0);

CREATE UNIQUE INDEX "ProductListing_one_available_used_offer_per_product_key"
  ON "ProductListing"("legoProductId")
  WHERE "condition" = 'USED_LIKE_NEW' AND "currentStock" = 1;

-- Used offers are created only as one available physical item. Their condition
-- and identity cannot be changed, and a terminal item cannot become available.
CREATE FUNCTION enforce_used_offer_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."condition" IS DISTINCT FROM NEW."condition" THEN
    RAISE EXCEPTION 'A listing condition cannot be changed' USING ERRCODE = '23514';
  END IF;

  IF NEW."condition" = 'USED_LIKE_NEW' THEN
    IF TG_OP = 'INSERT' AND (NEW."usedLifecycle" IS DISTINCT FROM 'AVAILABLE' OR NEW."currentStock" <> 1 OR NEW."reservedStock" <> 0) THEN
      RAISE EXCEPTION 'Used offers must be created available with exactly one unreserved item' USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD."condition" = 'USED_LIKE_NEW' THEN
      IF OLD."usedLifecycle" IN ('SOLD', 'RETIRED') AND (
        NEW."usedLifecycle" IS DISTINCT FROM OLD."usedLifecycle" OR
        NEW."currentStock" <> 0 OR NEW."reservedStock" <> 0 OR
        NEW."damageDescription" IS DISTINCT FROM OLD."damageDescription"
      ) THEN
        RAISE EXCEPTION 'A terminal Used offer cannot be revived or have its condition history changed' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProductListing_used_lifecycle_guard"
  BEFORE INSERT OR UPDATE ON "ProductListing"
  FOR EACH ROW EXECUTE FUNCTION enforce_used_offer_lifecycle();

-- Every Used offer must retain 1–3 item-specific photos throughout its life.
CREATE FUNCTION check_used_condition_photos() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_listing_id INTEGER;
  lifecycle "UsedOfferLifecycle";
  photo_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'ProductListing' THEN
    target_listing_id := COALESCE(NEW."id", OLD."id");
  ELSIF TG_OP = 'DELETE' THEN
    target_listing_id := OLD."listingId";
  ELSE
    target_listing_id := NEW."listingId";
  END IF;
  SELECT "usedLifecycle" INTO lifecycle FROM "ProductListing" WHERE "id" = target_listing_id;
  IF lifecycle IS NOT NULL THEN
    SELECT count(*) INTO photo_count FROM "UsedConditionPhoto" WHERE "listingId" = target_listing_id;
    IF photo_count < 1 OR photo_count > 3 THEN
      RAISE EXCEPTION 'Used offers require 1 to 3 condition photos' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "ProductListing_used_photos_required"
  AFTER INSERT OR UPDATE ON "ProductListing" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_used_condition_photos();
CREATE CONSTRAINT TRIGGER "UsedConditionPhoto_count_check"
  AFTER INSERT OR UPDATE OR DELETE ON "UsedConditionPhoto" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_used_condition_photos();

-- Evidence cannot be moved, replaced, appended, or removed after an offer is
-- terminal. A returned item must be assessed into a new listing with new evidence.
CREATE FUNCTION protect_terminal_used_photos() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  lifecycle "UsedOfferLifecycle";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."listingId" <> OLD."listingId" THEN
    RAISE EXCEPTION 'Condition photos cannot be moved between Used offers' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT "usedLifecycle" INTO lifecycle FROM "ProductListing" WHERE "id" = NEW."listingId";
  ELSE
    SELECT "usedLifecycle" INTO lifecycle FROM "ProductListing" WHERE "id" = OLD."listingId";
  END IF;
  IF lifecycle IN ('SOLD', 'RETIRED') THEN
    RAISE EXCEPTION 'Condition photos on terminal Used offers are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "UsedConditionPhoto_terminal_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "UsedConditionPhoto"
  FOR EACH ROW EXECUTE FUNCTION protect_terminal_used_photos();
