export class EmailVerificationUserNotFoundError extends Error {
  constructor(userId: number) {
    super(`User with id ${userId} not found`);
    this.name = "EmailVerificationUserNotFoundError";
  }
}

export class InvalidOrExpiredVerificationTokenError extends Error {
  constructor() {
    super("Invalid or expired email verification token");
    this.name = "InvalidOrExpiredVerificationTokenError";
  }
}
