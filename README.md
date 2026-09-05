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

Build the project first:

```bash
npm run build
```

Then run the test suite using the project's configured test command.

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