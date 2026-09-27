import type { Response } from "express";

export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "SESSION_INVALID"
  | "FORBIDDEN"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "INTERNAL_SERVER_ERROR"
  | "INVALID_SUPPLIER_KEY"
  | "PURCHASE_ANALYTICS_SUPPLIER_NOT_FOUND";

/** Sends a stable machine-readable API error envelope. */
export function sendApiError(res: Response, status: number, code: ApiErrorCode, message: string) {
  return res.status(status).json({ error: { code, message } });
}
