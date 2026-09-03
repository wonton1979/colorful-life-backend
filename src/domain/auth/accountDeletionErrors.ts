export class AccountDeletionUserNotFoundError extends Error {
  constructor() { super("User not found"); this.name = "AccountDeletionUserNotFoundError"; }
}

export class AccountDeletionAdminNotAllowedError extends Error {
  constructor() { super("Administrator accounts cannot be deleted"); this.name = "AccountDeletionAdminNotAllowedError"; }
}
