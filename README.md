# Colorful Life Backend

Backend API for **Colorful Life**, a production-oriented e-commerce platform built for selling LEGO sets and related products.

The project focuses on the parts of e-commerce where correctness matters most: inventory consistency, order lifecycle management, payment reconciliation, concurrency, idempotency, and refund accounting.

The backend currently supports the core customer journey from product discovery through payment, fulfilment, cancellation, return, and refund.

> **Status:** Backend V1 core complete. Customer storefront and production deployment are in progress.

---

## Tech Stack

- **Node.js 22**
- **TypeScript**
- **Express**
- **PostgreSQL**
- **Prisma ORM**
- **Zod**
- **JWT authentication**
- **Stripe**
- **PayPal**
- **Node.js Test Runner**

Planned production infrastructure:

```text
Route 53
   ↓
Application Load Balancer
   ↓
ECS Fargate
   ↓
RDS PostgreSQL
```

---

## Core Features

### Product Catalogue

- Product and listing management
- LEGO set number matching
- Product search
- Filtering
- Pagination
- Listing images
- Inventory-aware catalogue data

Public `GET /products` returns `{ items, pagination }` with one product card per
LegoProduct. A card's top-level `id` is the LegoProduct/product-card identity.
Its `offers` array contains the separately purchasable ProductListings, and each
`offers[].id` is the ProductListing identity. Offer `availableStock` is calculated
as `Math.max(0, currentStock - reservedStock)`; reserved stock is not exposed.
The product-level `GET /products/by-product/:productId` route returns the same
product identity with its currently available offers. The existing `GET
/products/:id` route remains a listing-level lookup by ProductListing ID.
Cart and order requests also use ProductListing IDs (`offers[].id`), never the
top-level product-card ID. Availability reflects inventory at read time; order
creation still checks and reserves stock atomically.

`LegoProduct.isRetired` is manually managed Admin metadata shared by every NEW
and USED_LIKE_NEW offer for that set. Admin `POST /products` accepts an optional
JSON boolean `isRetired` (omission uses the database default `false`); Admin
`PATCH /products/:id` accepts either `true` or `false` to edit the shared product
through a listing ID. Omitting the field during an edit preserves its value.
Strings, numbers, and `null` are rejected. Retirement has no automatic effect on
inventory, availability, pricing, feature selection, or Used offer lifecycle.

`GET /admin/products`, `GET /products`, and
`GET /products/by-product/:productId` expose `isRetired` on each product.
Listing detail (`GET /products/:id`) and product create/update responses expose
it as `legoProduct.isRetired`. Admin should provide one shared product toggle,
independent of offer condition and `UsedOfferLifecycle.RETIRED`.

### Admin Presentation Listing Feed

`GET /admin/product-listings` requires a Bearer token for an ADMIN account
(401 for missing/invalid authentication, 403 for a non-Admin). It returns one
record per ProductListing, including zero-stock, fully reserved, inactive, and
historical Used listings. Products without listings have no record in this feed.
This read-only endpoint does not apply public catalogue sellability filters.
`GET /products` and the LegoProduct search contract of `GET /admin/products`
remain unchanged.

Query parameters follow Admin lookup pagination: `page` defaults to 1 and must
be an integer from 1 to 10,000; `pageSize` defaults to 20 and must be an integer
from 1 to 50. Invalid or unknown parameters return 400. Listings are ordered by
`id` ascending. Pages beyond the end return empty `items` with accurate totals.
Each request reads its count and page from the same database snapshot; separate
page requests may reflect intervening writes.

The exact response shape is:

```ts
{
  items: Array<{
    id: number; // ProductListing ID for existing feature/artwork operations
    condition: "NEW" | "USED_LIKE_NEW";
    active: boolean;
    usedLifecycle: "AVAILABLE" | "SOLD" | "RETIRED" | null;
    currentStock: number;
    availableStock: number; // Math.max(0, currentStock - reservedStock)
    isFeatureProduct: boolean;
    catalogueArtworkUrl: string | null;
    catalogueArtworkPublicId: string | null;
    legoProduct: {
      id: number;
      setNumber: string;
      title: string;
      category: { id: number; name: string } | null;
    };
  }>;
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}
```

Categories come directly from the backend Category relation, including newly
created categories such as Juniors. `availableStock` describes inventory only;
it does not imply that an inactive or historical listing is sellable. Feature
and artwork values belong to the exact listing, not an aggregation of its offers.
Admin Presentation Management must separately switch to this endpoint, paginate
through the results, and use `items[].id` for existing listing feature/artwork
actions. This Backend change does not update the Admin consumer.

### Customer Accounts

- Registration and authentication
- JWT-based authorization
- Customer profile management
- Email verification
- Password reset
- Email address changes
- UK address lookup
- Multiple customer addresses
- Default shipping and billing addresses
- Account deletion and personal-data erasure

### Orders

- Customer order creation
- Server-authoritative pricing
- Order lifecycle management
- Inventory reservation
- Reservation expiry
- Overselling protection
- Customer order history
- Seller cancellation
- Customer cancellation rules
- Dispatch tracking
- Manual order completion

### Inventory

- Physical stock tracking
- Reserved stock tracking
- Atomic inventory reservation
- Inventory movements
- Website-sale deductions
- Cancellation restoration
- Condition adjustment
- Stock write-off

### Payments

Supported payment providers:

- Stripe
- PayPal
- Manual payments

Payment processing includes:

- Provider-specific payment creation
- Server-derived payment amounts
- Stable idempotency
- Duplicate-payment protection
- Provider reconciliation
- Signed webhook handling
- Payment failure/cancellation handling
- Late-payment protection for expired orders

### Returns & Refunds

- Return management
- Partial refunds
- Stripe refunds
- PayPal refunds
- Manual refunds
- Refund-capacity reservation
- Concurrent refund protection
- Provider reconciliation
- Idempotent webhook processing
- Over-refund protection

### Fulfilment

- Order dispatch
- Shipping carrier
- Tracking number
- Actual shipping cost
- Dispatch notifications
- Order completion

---

## Commerce Lifecycle

A normal customer order follows this lifecycle:

```text
Product Catalogue
       ↓
Create Order
       ↓
PENDING
       ↓
Reserve Inventory
       ↓
Stripe / PayPal
       ↓
Provider Payment
       ↓
Webhook Reconciliation
       ↓
CONFIRMED
       ↓
DISPATCHED
       ↓
COMPLETED
```

The browser is never treated as the authority for payment or inventory state.

---

## Inventory Reservation

Inventory is separated into two concepts:

```text
currentStock
```

represents physical stock, while:

```text
reservedStock
```

represents stock committed to pending customer orders.

Available stock is therefore derived from:

```text
availableStock = currentStock - reservedStock
```

When an order is created, inventory is reserved atomically without immediately reducing physical stock.

Pending reservations expire after a defined reservation window.

When payment is successfully reconciled and the order is confirmed:

```text
reservedStock ↓
currentStock  ↓
```

and the corresponding inventory movement is recorded.

If an unpaid pending order expires or is cancelled, its reservation is released without changing physical stock.

This separation allows the backend to protect inventory during checkout without treating an unpaid order as a completed sale.

---

## Overselling Protection

Inventory reservation is performed atomically.

Concurrent customers cannot successfully reserve the same final unit of stock.

The backend does not rely on a frontend stock check because a value displayed in the browser may already be stale by the time an order is submitted.

The database therefore remains the authority for inventory availability.

---

## Payment Architecture

Payment providers are represented internally rather than selected by arbitrary client input.

```text
Payment
├── MANUAL
├── STRIPE
└── PAYPAL
```

The backend derives authoritative payment information from the persisted order.

The client cannot determine:

- authoritative order amount
- payment amount
- currency
- refund provider
- final payment state

A typical provider payment flow is:

```text
Customer
   ↓
Backend
   ↓
Validate Order
   ↓
Derive Amount from Order
   ↓
Create / Reuse Provider Payment
   ↓
Stripe / PayPal
   ↓
Provider Webhook
   ↓
Signature / Event Validation
   ↓
Reconciliation
   ↓
Local Payment State
```

Provider network requests are intentionally performed **outside database transactions**.

---

## Idempotency

Payment and refund operations use stable idempotency identities.

This protects the system from situations such as:

- customer retries
- network timeouts
- duplicated HTTP requests
- provider retries
- webhook redelivery
- concurrent requests

A retry should converge on the existing logical payment or refund rather than create additional financial operations.

---

## Webhook Reconciliation

Provider webhooks are treated as external financial evidence.

Webhook events are recorded using `PaymentWebhookEvent` and deduplicated by provider event identity.

The Stripe webhook endpoint verifies the raw request body using the Stripe signature and webhook signing secret before reconciliation.

Webhook processing is designed to be idempotent:

```text
Provider event
      ↓
Verify
      ↓
Deduplicate
      ↓
Correlate
      ↓
Validate amount / currency / identity
      ↓
Reconcile local state
```

Repeated delivery must not double-apply payment or refund accounting.

---

## Late Payment Protection

An important edge case occurs when a customer begins payment but the local inventory reservation expires before the payment provider reports final success.

Colorful Life deliberately does **not** resurrect the expired order.

```text
Reservation expires
       ↓
Order = EXPIRED
       ↓
Inventory released
       ↓
Provider later reports successful payment
       ↓
Payment is recognised
       ↓
Order remains EXPIRED
       ↓
Refund / reconciliation required
```

The backend does not:

- reactivate the expired order
- silently reserve inventory again
- fulfil an order whose inventory commitment has already expired

This prevents a late provider response from creating an oversold order.

---

## Refund Accounting

Refunds distinguish between money already confirmed as refunded and refund capacity currently held by an in-progress provider operation.

```text
Payment.refundedAmount
```

represents provider-confirmed refunded money.

```text
Payment.reservedRefundAmount
```

represents refund capacity reserved by non-final refund attempts.

The core invariant is:

```text
refundedAmount + reservedRefundAmount <= paymentAmount
```

A refund therefore follows approximately:

```text
Admin requests refund
       ↓
Read original Payment provider
       ↓
Check refundable capacity
       ↓
Atomically reserve capacity
       ↓
Commit DB transaction
       ↓
Call Stripe / PayPal
       ↓
Provider response / webhook
       ↓
Final reconciliation
```

The client does not choose whether a refund goes through Stripe or PayPal.

The backend uses the provider stored on the original payment.

This prevents concurrent or repeated refund requests from exceeding the amount originally paid.

---

## Stripe Integration

Stripe support includes:

- PaymentIntent creation and reuse
- Server-authoritative GBP amounts
- Stable idempotency
- PaymentIntent correlation
- Payment webhook reconciliation
- Stripe refund creation
- Refund reconciliation
- Signed webhook verification
- Duplicate webhook handling
- Late-payment handling

Handled payment events include:

```text
payment_intent.succeeded
payment_intent.payment_failed
payment_intent.canceled
```

Refund reconciliation handles:

```text
refund.created
refund.updated
refund.failed
```

Stripe secrets and webhook signing secrets remain backend-only.

The frontend will use only Stripe's publishable credentials and transient payment data required for checkout.

---

## PayPal Integration

PayPal support includes:

- PayPal Order creation
- Payment capture
- Payment reconciliation
- Webhook handling
- Refund creation
- Refund-capacity protection
- Idempotency
- Provider identity tracking

Additional real PayPal Sandbox webhook verification is planned after the backend is available through its public HTTPS sandbox endpoint.

---

## Authentication & Security

Security-related behaviour includes:

- Password hashing
- JWT authentication
- Role-based authorization
- Verified-email requirements for protected customer actions
- Password reset
- Controlled email changes
- Customer ownership checks
- Server-side request validation
- Server-authoritative prices and payment amounts
- Payment-provider webhook verification
- Idempotent provider operations
- Personal-data erasure

Sensitive credentials are supplied through environment variables and must never be committed to the repository.

---

## API Structure

The API is organised around business domains including:

```text
Authentication
Users
Addresses
Products
Orders
Payments
Returns
Refunds
Purchases
Inventory
Business Expenses
```

Routes delegate business rules to domain/service layers rather than placing financial or inventory logic directly inside HTTP controllers.

---

## Testing

The backend has extensive automated coverage across domain logic, HTTP behaviour, persistence, concurrency, payments, refunds, and provider reconciliation.

Current normal regression result:

```text
tests:      619
suites:     83
passed:     616
failed:     0
skipped:    3
```

The three normally skipped tests are explicit opt-in Stripe Sandbox integration tests.

Normal test execution therefore does not make real Stripe network requests.

### Real Stripe Sandbox Verification

The Stripe integration has additionally been tested against the real Stripe Sandbox.

Verified flows include:

```text
Backend
   ↓
Real Stripe Sandbox PaymentIntent
   ↓
Payment confirmation
   ↓
Real Stripe webhook
   ↓
Production webhook endpoint
   ↓
Signature verification
   ↓
Payment reconciliation
```

and:

```text
Backend
   ↓
Real Stripe Sandbox Refund
   ↓
Real Stripe refund event
   ↓
Production webhook endpoint
   ↓
Signature verification
   ↓
Refund reconciliation
```

These opt-in tests verify the external provider boundary without making real-provider calls part of the normal regression suite.

---

## Local Development

### Requirements

- Node.js 22
- PostgreSQL
- npm

Install dependencies:

```bash
npm install
```

Generate the Prisma client:

```bash
npx prisma generate
```

Apply available database migrations:

```bash
npx prisma migrate deploy
```

Build:

```bash
npm run build
```

Start the compiled application:

```bash
npm start
```

---

## Running Tests

Development uses `DATABASE_URL` (normally database `colorful_life`). Automated
tests require a separate `TEST_DATABASE_URL` targeting **exactly
`colorful_life_test`**. Put both URLs in your ignored `.env`, or supply them as
environment variables; see `.env.example`. Credentials must not be committed.
There is no automatic fallback from a missing test URL to the development URL.

Create an empty `colorful_life_test` database on your local PostgreSQL server,
preferably owned by a dedicated test role with no access to development or
production data. For example, using PostgreSQL client tools:

```bash
createdb --host <local-postgres-host> --port 5432 --username <database-admin> \
  --owner <test-role> colorful_life_test
```

In WSL, use the reachable Windows PostgreSQL host address if PostgreSQL runs on
Windows; `localhost` may not resolve to that server. Obtain the host from your
existing local setup. The role must already exist and be allowed to own the test
database. Enter credentials through the PostgreSQL prompt or your local secret
configuration, not a committed command. Do not copy development data into tests.

Run the connection-free safety checks before preparing the database:

```bash
npm run test:safety
npm run test:db:check
```

`test:db:check` builds and validates configuration, reports only the test database
name, and verifies the application selects that URL without connecting to a
database. Normal application startup continues to use `DATABASE_URL` unchanged.

Prepare the schema and run tests:

```bash
npm run test:db:prepare
npm test
# Or run selected compiled integration files:
npm test -- dist/__tests__/cataloguePresentation.integration.test.js
```

Both preparation and `npm test` build first and apply the committed Prisma
migrations using `prisma migrate deploy` against the validated test target.
Applying migrations is repeatable; there is no reset, seed, or development-data
dependency. Tests create and clean up their own fixtures. Test files run serially
to avoid interference between catalogue queries and category-wide feature
selection. Do not run multiple suites against the same test database concurrently.

The shared guard runs before Prisma client construction and before migration or
test subprocesses start. It requires both URLs, rejects production mode, requires
the exact test database name, and rejects matching normal/test database names
even when credentials or host aliases differ. Test URL query parameters are
restricted to `schema=public` and one `sslmode` (`disable`, `require`, `verify-ca`,
or `verify-full`); connection redirection options are rejected. Unsafe or missing
configuration exits nonzero before database activity. Node test workers and direct
`.test.js` execution also use this guard; setting `NODE_ENV=test` alone is
insufficient. Use the npm commands to ensure current builds and migrations.

Real Stripe Sandbox tests are opt-in and require the corresponding environment flag and test credentials.

They must never be enabled against live Stripe credentials.

---

## Environment Configuration

The application uses environment variables for infrastructure and third-party integrations.

Depending on the environment, these include configuration for:

```text
Database
JWT
Email delivery
Stripe
PayPal
Application port / runtime configuration
```

Payment-provider secrets must remain server-side.

Never commit:

```text
.env
Stripe secret keys
Stripe webhook signing secrets
PayPal client secrets
database credentials
JWT secrets
AWS credentials
```

---

## Deployment

The intended production architecture is:

```text
                    ┌──────────────┐
                    │   Route 53   │
                    └──────┬───────┘
                           │
                           ▼
                 ┌──────────────────┐
                 │       ALB        │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │   ECS Fargate    │
                 │  Express API     │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │ RDS PostgreSQL   │
                 └──────────────────┘
```

Planned environments:

```text
sandbox-api.colorful-life.co.uk
→ Sandbox backend
→ Stripe Sandbox
→ PayPal Sandbox
→ Sandbox database
```

```text
api.colorful-life.co.uk
→ Production backend
→ Stripe Live
→ PayPal Live
→ Production database
```

Deployment is currently pending while the customer-facing storefront is developed.

---

## Current Project Status

### Backend

**V1 core complete.**

Core commerce functionality, inventory reservation, order lifecycle, authentication, payments, returns, refunds, and Stripe Sandbox verification are implemented.

### Frontend

Customer storefront development is the next major project phase.

The intended customer journey is:

```text
Home
→ Catalogue
→ Product Detail
→ Cart
→ Account / Address
→ Checkout
→ Stripe / PayPal
→ Order Confirmation
→ My Orders
```

### Deployment

Production deployment will follow once the customer storefront can exercise the backend as a genuine end-to-end commerce application.

Real public PayPal Sandbox webhook verification will be completed against the deployed sandbox backend before production payment activation.

---

## Development Principles

Several rules guide the project:

1. **The database is authoritative for inventory and commerce state.**
2. **The client never controls authoritative prices or payment amounts.**
3. **Inventory must be protected against concurrent overselling.**
4. **External provider calls should not hold database transactions open.**
5. **Payments and refunds must be idempotent.**
6. **Webhook delivery must be safe to repeat.**
7. **Late payments must not resurrect expired inventory reservations.**
8. **Provider state is reconciled rather than blindly trusted.**
9. **Refund capacity must be reserved before asynchronous refund processing.**
10. **Real provider behaviour is verified with Sandbox integration tests rather than assumed.**

---

## Roadmap

Next:

- Customer storefront V1
- Product catalogue integration
- Customer authentication UI
- Cart and checkout
- Stripe checkout integration
- PayPal checkout integration
- Customer order history
- Sandbox deployment
- Public PayPal Sandbox webhook verification
- Production deployment
