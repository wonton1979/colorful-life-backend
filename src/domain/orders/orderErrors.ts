// Custom domain error classes for Order creation
// Follow the style used in the existing purchase error module

// -----------------------------------------------------------------------------
// Address related errors
// -----------------------------------------------------------------------------
export class NoDefaultBillingAddressError extends Error {
  constructor() {
    super("No default billing address found for the user");
    this.name = "NoDefaultBillingAddressError";
  }
}

export class MultipleDefaultBillingAddressesError extends Error {
  constructor() {
    super("Multiple default billing addresses found for the user");
    this.name = "MultipleDefaultBillingAddressesError";
  }
}

// -----------------------------------------------------------------------------
// Product listing related errors
// -----------------------------------------------------------------------------
export class ProductListingNotFoundError extends Error {
  constructor(productListingId: number) {
    super(`Product listing with id ${productListingId} does not exist`);
    this.name = "ProductListingNotFoundError";
  }
}

export class ProductListingInactiveError extends Error {
  constructor(productListingId: number) {
    super(`Product listing with id ${productListingId} is inactive`);
    this.name = "ProductListingInactiveError";
  }
}

// -----------------------------------------------------------------------------
// Order item duplicate error
// -----------------------------------------------------------------------------
export class DuplicateProductListingError extends Error {
  constructor(productListingId: number) {
    super(`Duplicate product listing id ${productListingId} in order items`);
    this.name = "DuplicateProductListingError";
  }
}
