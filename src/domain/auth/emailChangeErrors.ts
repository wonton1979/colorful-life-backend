export class EmailChangeUserNotFoundError extends Error {
  constructor() { super("User not found"); this.name = "EmailChangeUserNotFoundError"; }
}

export class EmailChangeVerifiedUserError extends Error {
  constructor() { super("Verified email cannot be changed"); this.name = "EmailChangeVerifiedUserError"; }
}

export class EmailChangeSameEmailError extends Error {
  constructor() { super("New email must differ from current email"); this.name = "EmailChangeSameEmailError"; }
}

export class EmailChangeDuplicateEmailError extends Error {
  constructor() { super("Email already in use"); this.name = "EmailChangeDuplicateEmailError"; }
}
