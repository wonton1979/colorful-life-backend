CREATE TABLE "Category" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "subtitle" TEXT,
  "description" TEXT,
  "imageUrl" TEXT,
  "imagePublicId" TEXT,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

INSERT INTO "Category" ("name", "subtitle") VALUES
  ('Harry Potter', 'Magic in every build'),
  ('Star Wars', 'Adventure among the stars'),
  ('Friends', 'Build brighter days together'),
  ('City', 'Every street tells a story'),
  ('Disney', 'Build a little wonder'),
  ('Marvel', 'Heroes assemble here'),
  ('Jurassic World', 'Big adventures from another age'),
  ('Flowers & Botanicals', 'Build something beautiful'),
  ('NINJAGO', 'Train. Build. Adventure.'),
  ('DC & Batman', 'Heroes after dark'),
  ('Vehicles', 'Built for the thrill'),
  ('Creator', 'Imagine it. Build it differently.'),
  ('Others', 'More little worlds to discover')
ON CONFLICT ("name") DO NOTHING;

ALTER TABLE "LegoProduct" ADD COLUMN "categoryId" INTEGER;

UPDATE "LegoProduct" AS lp
SET "categoryId" = c."id"
FROM "ProductListing" AS pl
JOIN "Category" AS c ON c."name" = CASE pl."colorfulLifeCategory"::text
  WHEN 'HARRY_POTTER' THEN 'Harry Potter'
  WHEN 'STAR_WARS' THEN 'Star Wars'
  WHEN 'FRIENDS' THEN 'Friends'
  WHEN 'CITY' THEN 'City'
  WHEN 'DISNEY' THEN 'Disney'
  WHEN 'MARVEL' THEN 'Marvel'
  WHEN 'JURASSIC_WORLD' THEN 'Jurassic World'
  WHEN 'FLOWERS_AND_BOTANICALS' THEN 'Flowers & Botanicals'
  WHEN 'NINJAGO' THEN 'NINJAGO'
  WHEN 'HEROES' THEN 'DC & Batman'
  WHEN 'VEHICLES' THEN 'Vehicles'
  WHEN 'CREATOR' THEN 'Creator'
  WHEN 'OTHERS' THEN 'Others'
END
WHERE lp."id" = pl."legoProductId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "LegoProduct" lp
    WHERE lp."categoryId" IS NULL
      AND EXISTS (SELECT 1 FROM "ProductListing" pl WHERE pl."legoProductId" = lp."id")
  ) THEN
    RAISE EXCEPTION 'Cannot enforce LegoProduct.categoryId: listed products remain unmapped';
  END IF;
END $$;

ALTER TABLE "LegoProduct"
  ADD CONSTRAINT "LegoProduct_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "LegoProduct_categoryId_idx" ON "LegoProduct"("categoryId");
