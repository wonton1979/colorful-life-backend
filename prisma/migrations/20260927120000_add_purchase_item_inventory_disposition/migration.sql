BEGIN;

CREATE TYPE "PurchaseItemDisposition" AS ENUM ('INVENTORY', 'NON_INVENTORY');

ALTER TABLE "PurchaseItem"
ADD COLUMN "inventoryDisposition" "PurchaseItemDisposition" NOT NULL DEFAULT 'INVENTORY';

COMMIT;
