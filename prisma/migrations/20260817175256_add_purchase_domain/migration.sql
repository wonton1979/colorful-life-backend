-- CreateTable
CREATE TABLE "Purchase" (
    "id" SERIAL NOT NULL,
    "sourceOrderReference" TEXT NOT NULL,
    "sourceOrderDate" TIMESTAMP(3),
    "merchantName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseDocument" (
    "id" SERIAL NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "partNumber" INTEGER NOT NULL,
    "sourceInvoiceReference" TEXT,
    "importHash" VARCHAR(64) NOT NULL,
    "sourceDocumentDate" TIMESTAMP(3),
    "importedByUserId" INTEGER NOT NULL,
    "originalGrossMerchandiseTotal" DECIMAL(12,2) NOT NULL,
    "shippingTotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "finalTotalPaid" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" SERIAL NOT NULL,
    "purchaseDocumentId" INTEGER NOT NULL,
    "productListingId" INTEGER,
    "externalProductId" TEXT,
    "sourceDescription" TEXT NOT NULL,
    "sourceSetNumber" TEXT,
    "sourceLineNumber" INTEGER,
    "quantity" INTEGER NOT NULL,
    "originalGrossUnitCost" DECIMAL(12,2) NOT NULL,
    "originalGrossLineTotal" DECIMAL(12,2) NOT NULL,
    "allocatedShipping" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "allocatedDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "finalLineCost" DECIMAL(12,2) NOT NULL,
    "finalUnitCost" DECIMAL(14,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_sourceOrderReference_key" ON "Purchase"("sourceOrderReference");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDocument_importHash_key" ON "PurchaseDocument"("importHash");

-- CreateIndex
CREATE INDEX "PurchaseDocument_purchaseId_idx" ON "PurchaseDocument"("purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseDocument_importedByUserId_idx" ON "PurchaseDocument"("importedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDocument_purchaseId_partNumber_key" ON "PurchaseDocument"("purchaseId", "partNumber");

-- CreateIndex
CREATE INDEX "PurchaseItem_purchaseDocumentId_idx" ON "PurchaseItem"("purchaseDocumentId");

-- CreateIndex
CREATE INDEX "PurchaseItem_productListingId_idx" ON "PurchaseItem"("productListingId");

-- CreateIndex
CREATE INDEX "PurchaseItem_externalProductId_idx" ON "PurchaseItem"("externalProductId");

-- CreateIndex
CREATE INDEX "PurchaseItem_sourceSetNumber_idx" ON "PurchaseItem"("sourceSetNumber");

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_importedByUserId_fkey" FOREIGN KEY ("importedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseDocumentId_fkey" FOREIGN KEY ("purchaseDocumentId") REFERENCES "PurchaseDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_productListingId_fkey" FOREIGN KEY ("productListingId") REFERENCES "ProductListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
