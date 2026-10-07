-- Additive only: historical Orders receive no provenance or cleanup tasks.
CREATE TYPE "CartReconciliationState" AS ENUM ('ACTIVE', 'CONSUME_PENDING', 'RELEASE_PENDING', 'CONSUMED', 'RELEASED');
CREATE TABLE "OrderCartProvenance" (
  "orderId" INTEGER PRIMARY KEY REFERENCES "Order"("id") ON DELETE CASCADE,
  "cartId" INTEGER NOT NULL REFERENCES "Cart"("id") ON DELETE CASCADE,
  "state" "CartReconciliationState" NOT NULL DEFAULT 'ACTIVE',
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT
);
CREATE TABLE "OrderCartAllocation" (
  "id" SERIAL PRIMARY KEY,
  "orderId" INTEGER NOT NULL REFERENCES "OrderCartProvenance"("orderId") ON DELETE CASCADE,
  "cartItemId" INTEGER REFERENCES "CartItem"("id") ON DELETE SET NULL,
  "productListingId" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "visibleQuantity" INTEGER NOT NULL CHECK ("visibleQuantity" >= 0 AND "visibleQuantity" <= "quantity")
);
CREATE UNIQUE INDEX "OrderCartAllocation_orderId_productListingId_key" ON "OrderCartAllocation"("orderId", "productListingId");
CREATE INDEX "OrderCartAllocation_cartItemId_idx" ON "OrderCartAllocation"("cartItemId");
CREATE INDEX "OrderCartProvenance_state_orderId_idx" ON "OrderCartProvenance"("state", "orderId");
CREATE INDEX "OrderCartProvenance_cartId_state_idx" ON "OrderCartProvenance"("cartId", "state");
