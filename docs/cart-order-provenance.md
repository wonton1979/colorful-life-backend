# Cart provenance and confirmed-order reconciliation

## Customer contract

Cart quantities remain visible when an order is created. `quantity` is the total;
`allocatedQuantity` is still associated with pending/queued order provenance and
`unallocatedQuantity` is available to another checkout. These two cart-item fields
are additive; raw allocations and order references are not exposed. Provenance is
not inventory reservation. Stock checks for new intent exclude allocated quantity.

`POST /orders` associates requested quantities with matching saved CartItem rows in
the same transaction as creation and reservation. Each matching line must have
enough unallocated quantity, otherwise HTTP 409 returns
`{ "error": { "code": "CART_QUANTITY_UNAVAILABLE", "message": "..." } }`.
A different Order cannot claim another Order's allocation. Additional unallocated
quantity can support a later Order. Request lines absent from the saved cart keep
the direct-order contract and have no cart effect. Association is line-specific.

The existing `Idempotency-Key` contract/hash is unchanged: retries return the same
Order without another allocation; mismatches retain `ORDER_IDEMPOTENCY_MISMATCH`.
Clients should recover an existing pending Order rather than submit its already
allocated visible quantities as a new Order. No frontend changes are included.

## Mutations and terminal orders

- POST adds new unallocated shopping intent, including to an allocated listing.
- PATCH still sets total visible quantity (positive integers; zero remains invalid).
  Reductions discard unallocated intent first, then detach allocated portions,
  oldest Order first. The Order snapshot and stock reservation remain intact.
- Item DELETE and cart DELETE detach affected visible allocations and remove rows.
  They do not cancel Orders. Recreating the same listing creates a new row identity
  that old provenance can never consume. If queued confirmation removes the last
  quantity during DELETE, DELETE still succeeds for the original row; PATCH applies
  its target as fresh intent after settling that confirmation.

PENDING allocations stay active after failed/canceled payment attempts. Unpaid
Order cancellation/expiry queues release: still-visible quantity becomes
unallocated, with no restoration of removed portions. Confirmation consumes only
still-attached allocation quantity. Legitimate overlapping Orders can confirm in
any order. Cancellation/refund after confirmation does not restore purchased cart
quantity. Late Stripe success on EXPIRED/CANCELLED Orders keeps existing payment/
exception semantics: no resurrection and no consumption of released intent.

## Authority, failure isolation and operation

Stripe webhook and missed-webhook recovery converge on `applyStripePaymentOutcome`
and `confirmOrderInTransaction`. Confirmation queues CONSUME_PENDING atomically
with payment/inventory/Order state. The existing ADMIN confirmation transition
shares the hook; its authorization/payment rules are not redesigned. Unpaid
cancellation/expiry queues RELEASE_PENDING. No provenance means the queue update
is a no-op. Initiation, failed payment, Order reads and cart reads never consume.

Actual cleanup runs separately: cart changes, zeroing attached quantities and the
CONSUMED/RELEASED marker commit together. Failure rolls cart changes back and leaves
retryable work with `lastError`; financial confirmation stays committed. Normal
`src/index.ts` (`npm start`) starts an immediate drain and five-second polling.
Multiple instances/restarts are safe. The worker pages through pending tasks so a
failed early customer does not starve later customers. Cart mutations and allocation
creation also settle committed work before quantity decisions. Reads never clean up.

Cleanup is eventually consistent: CONFIRMED can briefly coexist with pending cart
work. Alternative backend entry points must schedule `reconcilePendingCarts`.
Monitor pending tasks with `lastError`. Unsupported data corruption requires repair
before retry succeeds; the worker never guesses subtraction from recreated rows.

## Locks

Cart mutations, allocation creation and reconciliation share a transaction-scoped
PostgreSQL advisory lock named `cart:<customerId>`. No User-row lock is taken,
because inventory movements acquire User FK locks. Different customers remain
independent; there is no process-local correctness lock.

Stock-validating cart paths: cart lock → listing lock → provenance/cart writes.
Creation: existing idempotency lock → cart lock → ascending listing locks → new
Order/provenance. Lazy expiry runs beforehand; creation never locks existing Orders
while holding the cart lock. Matching retries return before allocation work.

Financial confirmation/cancellation/expiry: existing Order lock → ascending stock
listing locks → task state; never cart locks. Reconciliation: cart lock → cart/
allocation/task writes; never Order, payment, User-row or inventory locks.

## Migration and legacy behavior

`20261007120000_add_order_cart_provenance` adds two tables and a state enum, an
Order-scoped key, per-order/listing uniqueness, lookup indexes and quantity checks.
CartItem foreign keys use ON DELETE SET NULL. Original quantity survives detachment.
There is no legacy backfill or historical Order update. Absent provenance means
existing payment/read/confirmation behavior continues without cart subtraction.
Historical migrations/checksums are unchanged. Deploy the new migration before
starting this backend version. Do not reset databases or rewrite historical
migrations to resolve deployment drift.
