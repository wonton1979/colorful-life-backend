ALTER TABLE "ProductListing"
  ADD COLUMN "catalogueArtworkUrl" TEXT,
  ADD COLUMN "catalogueArtworkPublicId" TEXT,
  ADD COLUMN "isFeatureProduct" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "ProductListing_one_feature_per_category_idx"
  ON "ProductListing" ("colorfulLifeCategory")
  WHERE "isFeatureProduct" = true;
