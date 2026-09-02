export class PasswordResetUserNotFoundError extends Error {
  constructor(userId: number) {
    super(`User with id ${userId} not found`);
    this.name = "PasswordResetUserNotFoundError";
  }
}

export class InvalidOrExpiredPasswordResetTokenError extends Error {
  constructor() {
    super("Invalid or expired password reset token");
    this.name = "InvalidOrExpiredPasswordResetTokenError";
  }
}
