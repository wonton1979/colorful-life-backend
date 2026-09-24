-- Keep condition evidence mutations in the same listing-row lock domain as
-- sales and other lifecycle changes. Existing #110 installs already applied
-- the initial Used-offer migration, so replace its triggers in a forward-safe
-- migration rather than editing an applied migration.
CREATE OR REPLACE FUNCTION check_used_condition_photos() RETURNS trigger LANGUAGE plpgsql AS $$
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

  SELECT "usedLifecycle" INTO lifecycle
  FROM "ProductListing"
  WHERE "id" = target_listing_id
  FOR UPDATE;

  IF lifecycle IS NOT NULL THEN
    SELECT count(*) INTO photo_count
    FROM "UsedConditionPhoto"
    WHERE "listingId" = target_listing_id;
    IF photo_count < 1 OR photo_count > 3 THEN
      RAISE EXCEPTION 'Used offers require 1 to 3 condition photos' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION protect_terminal_used_photos() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_listing_id INTEGER;
  lifecycle "UsedOfferLifecycle";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."listingId" <> OLD."listingId" THEN
    RAISE EXCEPTION 'Condition photos cannot be moved between Used offers' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    target_listing_id := NEW."listingId";
  ELSE
    target_listing_id := OLD."listingId";
  END IF;

  SELECT "usedLifecycle" INTO lifecycle
  FROM "ProductListing"
  WHERE "id" = target_listing_id
  FOR UPDATE;

  IF lifecycle IN ('SOLD', 'RETIRED') THEN
    RAISE EXCEPTION 'Condition photos on terminal Used offers are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Historical terminal listings must remain present so their condition evidence
-- cannot be removed through the UsedConditionPhoto ON DELETE CASCADE path.
CREATE OR REPLACE FUNCTION enforce_used_offer_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."condition" = 'USED_LIKE_NEW' AND OLD."usedLifecycle" IN ('SOLD', 'RETIRED') THEN
      RAISE EXCEPTION 'A terminal Used offer cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."condition" IS DISTINCT FROM NEW."condition" THEN
    RAISE EXCEPTION 'A listing condition cannot be changed' USING ERRCODE = '23514';
  END IF;

  IF NEW."condition" = 'USED_LIKE_NEW' THEN
    IF TG_OP = 'INSERT' AND (NEW."usedLifecycle" IS DISTINCT FROM 'AVAILABLE' OR NEW."currentStock" <> 1 OR NEW."reservedStock" <> 0) THEN
      RAISE EXCEPTION 'Used offers must be created available with exactly one unreserved item' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."condition" = 'USED_LIKE_NEW' AND OLD."usedLifecycle" IN ('SOLD', 'RETIRED') AND (
      NEW."usedLifecycle" IS DISTINCT FROM OLD."usedLifecycle" OR
      NEW."currentStock" <> 0 OR NEW."reservedStock" <> 0 OR
      NEW."damageDescription" IS DISTINCT FROM OLD."damageDescription"
    ) THEN
      RAISE EXCEPTION 'A terminal Used offer cannot be revived or have its condition history changed' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER "ProductListing_used_lifecycle_guard" ON "ProductListing";
CREATE TRIGGER "ProductListing_used_lifecycle_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "ProductListing"
  FOR EACH ROW EXECUTE FUNCTION enforce_used_offer_lifecycle();
