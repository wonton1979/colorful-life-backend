ALTER TABLE "Payment" ADD COLUMN "providerCaptureReference" TEXT;
ALTER TABLE "Payment" ADD COLUMN "captureIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "Payment_provider_providerCaptureReference_key"
ON "Payment"("provider", "providerCaptureReference");

CREATE UNIQUE INDEX "Payment_captureIdempotencyKey_key"
ON "Payment"("captureIdempotencyKey");
