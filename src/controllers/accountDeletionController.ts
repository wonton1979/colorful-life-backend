import type { Request, Response } from "express";
import { deleteCustomerAccount } from "../domain/auth/accountDeletionService.js";
import {
  AccountDeletionAdminNotAllowedError,
  AccountDeletionUserNotFoundError,
} from "../domain/auth/accountDeletionErrors.js";

export const deleteCurrentUserAccount = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    await deleteCustomerAccount(userId);
    return res.status(204).send();
  } catch (error) {
    if (error instanceof AccountDeletionUserNotFoundError) {
      return res.status(404).json({ error: "User not found" });
    }
    if (error instanceof AccountDeletionAdminNotAllowedError) {
      return res.status(403).json({ error: "Not allowed" });
    }
    console.error("Account deletion error", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
