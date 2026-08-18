import { SourcePurchaseDocument } from "../../../domain/purchases/purchaseNormalizer.js";

/**
 * Golden fixture for a first‑supplier multi‑page purchase invoice.
 *
 * The values in this fixture intentionally match the exact raw shape
 * expected by the `normalizePurchaseDocument` function.  They are
 * deliberately kept as string representations of monetary amounts so that
 * the normaliser can perform its own parsing.
 *
 * Note: the `importHash` is a deterministic placeholder.  In the real
 * pipeline this value will be the SHA‑256 of the PDF file contents.
 */
export const multiPagePurchaseInvoiceFixture: SourcePurchaseDocument = {
  importHash: "TEST_IMPORT_HASH", // placeholder for real SHA‑256 hash
  sourceOrderReference: "202-6362918-3056349",
  sourceOrderDate: "09 Aug 2026",
  merchantName: "Amazon EU S.à r.l., UK Branch",
  sourceInvoiceReference: "GB66XG5UVAEUI",
  sourceDocumentDate: "10 Aug 2026",
  originalGrossMerchandiseTotal: "171.09",
  shippingTotal: "0.00",
  discountTotal: "2.99",
  finalTotalPaid: "168.10",
  items: [
    {
      sourceLineNumber: 1,
      sourceDescription:
        "LEGO | Marvel Iron Spider-Man Bust - Display Model Building Set for Adults incl. 2 Movable Arms, a Rotating Head & a Super Hero Minifigure - Collectible Avengers Gift for Fans - 76326",
      externalProductId: "B0DWDLM9XS",
      sourceSetNumber: "76326",
      quantity: 2,
      originalGrossUnitCost: "37.04",
      originalGrossLineTotal: "74.08"
    },
    {
      sourceLineNumber: 2,
      sourceDescription:
        "LEGO Jurassic World Raptor Off-Road Escape Dinosaur Toy - incl. 2 Dino Figures, Off-Road Car Toy & 2 Minifigures - Gift for 6+ Year Old Boys, Girls & Rebirth Movie Fans - 76972",
      externalProductId: "B0DNZS14DR",
      sourceSetNumber: "76972",
      quantity: 1,
      originalGrossUnitCost: "19.99",
      originalGrossLineTotal: "19.99"
    },
    {
      sourceLineNumber: 3,
      sourceDescription:
        "LEGO Jurassic World Raptor Off-Road Escape Dinosaur Toy - incl. 2 Dino Figures, Off-Road Car Toy & 2 Minifigures - Gift for 6+ Year Old Boys, Girls & Rebirth Movie Fans - 76972",
      externalProductId: "B0DNZS14DR",
      sourceSetNumber: "76972",
      quantity: 1,
      originalGrossUnitCost: "19.99",
      originalGrossLineTotal: "19.99"
    },
    {
      sourceLineNumber: 4,
      sourceDescription:
        "LEGO | Marvel Iron Spider-Man Bust - Display Model Building Set for Adults incl. 2 Movable Arms, a Rotating Head & a Super Hero Minifigure - Collectible Avengers Gift for Fans - 76326",
      externalProductId: "B0DWDLM9XS",
      sourceSetNumber: "76326",
      quantity: 1,
      originalGrossUnitCost: "37.04",
      originalGrossLineTotal: "37.04"
    },
    {
      sourceLineNumber: 5,
      sourceDescription:
        "LEGO Jurassic World Raptor Off-Road Escape Dinosaur Toy - incl. 2 Dino Figures, Off-Road Car Toy & 2 Minifigures - Gift for 6+ Year Old Boys, Girls & Rebirth Movie Fans - 76972",
      externalProductId: "B0DNZS14DR",
      sourceSetNumber: "76972",
      quantity: 1,
      originalGrossUnitCost: "19.99",
      originalGrossLineTotal: "19.99"
    }
  ]
};
