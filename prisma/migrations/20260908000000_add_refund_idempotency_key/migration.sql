ALTER TABLE "Refund" ADD COLUMN "refundIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "Refund_refundIdempotencyKey_key"
ON "Refund"("refundIdempotencyKey");
