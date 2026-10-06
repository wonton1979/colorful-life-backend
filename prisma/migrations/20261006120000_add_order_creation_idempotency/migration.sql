ALTER TABLE "Order" ADD COLUMN "creationIdempotencyKey" VARCHAR(128), ADD COLUMN "creationRequestHash" VARCHAR(64);
CREATE UNIQUE INDEX "Order_userId_creationIdempotencyKey_key" ON "Order"("userId", "creationIdempotencyKey");
