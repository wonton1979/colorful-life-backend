import type { NextFunction, Request, Response } from "express";
import { prisma } from "../prisma/runtime.js";

type VerifiedUserLookup = (userId: number) => Promise<{ emailVerified: boolean } | null>;

const databaseLookup: VerifiedUserLookup = (userId) =>
  prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } });

let lookupUser: VerifiedUserLookup = databaseLookup;

/** Restricts customer member routes using the current database User state. */
export async function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Missing or invalid authorization header" });

  // ADMIN routes are not expected to mount this middleware. Passing them through
  // keeps the middleware customer-oriented and preserves existing ADMIN policy.
  if (user.role === "ADMIN") return next();

  try {
    const currentUser = await lookupUser(user.id);
    if (!currentUser) return res.status(404).json({ error: "User not found" });
    if (!currentUser.emailVerified) return res.status(403).json({ error: "Email verification required" });
    return next();
  } catch (_error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export function setVerifiedEmailUserLookupForTests(testLookup: VerifiedUserLookup): () => void {
  const previous = lookupUser;
  lookupUser = testLookup;
  return () => { lookupUser = previous; };
}
