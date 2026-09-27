/** Canonical merchant names offered when an Admin manually enters a purchase. */
export const MANUAL_PURCHASE_SUPPLIER_OPTIONS = [
  "LEGO",
  "Amazon",
  "eBay",
  "Smyths Toys",
  "Argos",
  "John Lewis",
  "Very",
  "Costco",
  "ASDA",
  "B&M",
  "Sainsbury's",
  "Tesco",
  "Morrisons",
] as const;

/** UI-only choice for entering a custom merchantName; never persisted itself. */
export const MANUAL_PURCHASE_CUSTOM_SUPPLIER_LABEL = "Others" as const;
