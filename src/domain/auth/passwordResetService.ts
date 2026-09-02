import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../../prisma/runtime.js";
import type { Prisma } from "../../generated/prisma-client/client.js";
import {
  PasswordResetUserNotFoundError,
  InvalidOrExpiredPasswordResetTokenError,
} from "./passwordResetErrors.js";

const RESET_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
type PasswordResetTransactionClient = Prisma.TransactionClient;

export function hashPasswordResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

async function createTokenInTransaction(
  tx: PasswordResetTransactionClient,
  userId: number,
  now: Date,
) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new PasswordResetUserNotFoundError(userId);

  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_LIFETIME_MS);
  await tx.passwordResetToken.upsert({
    where: { userId },
    create: { userId, tokenHash: hashPasswordResetToken(rawToken), expiresAt },
    update: { tokenHash: hashPasswordResetToken(rawToken), expiresAt, createdAt: now },
  });
  return { rawToken, expiresAt };
}

export async function createOrReplacePasswordResetToken(userId: number, now = new Date()) {
  return prisma.$transaction((tx) => createTokenInTransaction(tx, userId, now));
}

export async function resetPassword(
  rawToken: string,
  newPassword: string,
  decisionTime = new Date(),
) {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const tokenHash = hashPasswordResetToken(rawToken);

  return prisma.$transaction(async (tx) => {
    const token = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true },
    });
    if (!token || token.expiresAt <= decisionTime) {
      throw new InvalidOrExpiredPasswordResetTokenError();
    }

    const consumed = await tx.passwordResetToken.deleteMany({
      where: { id: token.id, tokenHash, expiresAt: { gt: decisionTime } },
    });
    if (consumed.count !== 1) throw new InvalidOrExpiredPasswordResetTokenError();

    await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
    return { reset: true as const };
  });
}
