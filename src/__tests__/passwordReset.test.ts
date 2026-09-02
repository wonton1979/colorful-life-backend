import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../prisma/runtime.js";
import {
  createOrReplacePasswordResetToken,
  hashPasswordResetToken,
  resetPassword,
} from "../domain/auth/passwordResetService.js";
import { InvalidOrExpiredPasswordResetTokenError } from "../domain/auth/passwordResetErrors.js";

const userIds: number[] = [];

async function createUser(emailVerified = false) {
  const user = await prisma.user.create({
    data: { email: `reset-${randomUUID()}@example.com`, passwordHash: await bcrypt.hash("OldPassword1!", 4), emailVerified },
  });
  userIds.push(user.id);
  return user;
}

after(async () => {
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("password reset token domain", () => {
  it("creates a hashed one-hour token and replaces the previous token", async () => {
    const user = await createUser();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const first = await createOrReplacePasswordResetToken(user.id, now);
    const second = await createOrReplacePasswordResetToken(user.id, now);
    const stored = await prisma.passwordResetToken.findUnique({ where: { userId: user.id } });
    assert.notStrictEqual(second.rawToken, stored?.tokenHash);
    assert.strictEqual(stored?.tokenHash, hashPasswordResetToken(second.rawToken));
    assert.strictEqual(second.expiresAt.getTime(), now.getTime() + 60 * 60 * 1000);
    assert.strictEqual(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 1);
    await assert.rejects(() => resetPassword(first.rawToken, "NewPassword1!"), InvalidOrExpiredPasswordResetTokenError);
  });

  it("resets and consumes a valid token without changing email verification", async () => {
    const user = await createUser(false);
    const token = await createOrReplacePasswordResetToken(user.id);
    await resetPassword(token.rawToken, "NewPassword1!");
    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    assert.ok(updated);
    assert.equal(updated.emailVerified, false);
    assert.equal(await bcrypt.compare("NewPassword1!", updated.passwordHash), true);
    assert.equal(await bcrypt.compare("OldPassword1!", updated.passwordHash), false);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 0);
    await assert.rejects(() => resetPassword(token.rawToken, "AnotherPassword1!"), InvalidOrExpiredPasswordResetTokenError);
  });

  it("rejects unknown and expired tokens at the boundary", async () => {
    await assert.rejects(() => resetPassword("unknown", "NewPassword1!"), InvalidOrExpiredPasswordResetTokenError);
    const user = await createUser(true);
    const now = new Date("2026-01-01T00:00:00.000Z");
    const token = await createOrReplacePasswordResetToken(user.id, now);
    await assert.rejects(() => resetPassword(token.rawToken, "NewPassword1!", token.expiresAt), InvalidOrExpiredPasswordResetTokenError);
  });

  it("allows exactly one concurrent consumer", async () => {
    const user = await createUser();
    const token = await createOrReplacePasswordResetToken(user.id);
    const results = await Promise.allSettled([
      resetPassword(token.rawToken, "FirstPassword1!"),
      resetPassword(token.rawToken, "SecondPassword1!"),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected" && r.reason instanceof InvalidOrExpiredPasswordResetTokenError).length, 1);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 0);
  });
});
