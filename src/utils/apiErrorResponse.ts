import type { Response } from "express";

export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "SESSION_INVALID"
  | "FORBIDDEN"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "INTERNAL_SERVER_ERROR";

/** Sends the stable error envelope used for authentication and authorization failures. */
export function sendApiError(res: Response, status: number, code: ApiErrorCode, message: string) {
  return res.status(status).json({ error: { code, message } });
}
