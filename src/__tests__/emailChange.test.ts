import assert from "node:assert/strict";
import { after, afterEach, describe, it } from "node:test";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma/runtime.js";
import { createOrReplaceEmailVerificationToken, verifyEmailVerificationToken } from "../domain/auth/emailVerificationService.js";
import { changeUnverifiedUserEmail } from "../domain/auth/emailChangeService.js";
import { EmailChangeDuplicateEmailError, EmailChangeSameEmailError, EmailChangeVerifiedUserError } from "../domain/auth/emailChangeErrors.js";

const ids: number[] = [];
async function user(emailVerified = false) {
  const created = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, passwordHash: await bcrypt.hash("Abcdef1!", 4), emailVerified } });
  ids.push(created.id);
  return created;
}

afterEach(async () => {
  if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids.splice(0) } } });
});
after(async () => { await prisma.$disconnect(); });

describe("unverified email change domain", () => {
  it("updates only email, replaces the token, and returns the new raw token", async () => {
    const current = await user();
    const old = await createOrReplaceEmailVerificationToken(current.id);
    const result = await changeUnverifiedUserEmail(current.id, "new@example.com");
    const updated = await prisma.user.findUnique({ where: { id: current.id } });
    assert.equal(updated?.email, "new@example.com");
    assert.equal(updated?.emailVerified, false);
    assert.equal(updated?.role, "CUSTOMER");
    assert.equal(await prisma.emailVerificationToken.count({ where: { userId: current.id } }), 1);
    await assert.rejects(() => verifyEmailVerificationToken(old.rawToken!));
    await verifyEmailVerificationToken(result.rawToken!);
    assert.equal((await prisma.user.findUnique({ where: { id: current.id } }))?.emailVerified, true);
  });

  it("rejects verified and same-email changes without mutation", async () => {
    const verified = await user(true);
    await assert.rejects(() => changeUnverifiedUserEmail(verified.id, "new@example.com"), EmailChangeVerifiedUserError);
    const pending = await user();
    const token = await createOrReplaceEmailVerificationToken(pending.id);
    const originalHash = (await prisma.emailVerificationToken.findUnique({ where: { userId: pending.id } }))!.tokenHash;
    await assert.rejects(() => changeUnverifiedUserEmail(pending.id, pending.email), EmailChangeSameEmailError);
    assert.equal((await prisma.emailVerificationToken.findUnique({ where: { userId: pending.id } }))?.tokenHash, originalHash);
  });

  it("maps duplicate email and rolls back the original email/token", async () => {
    const owner = await user();
    const target = await user();
    const token = await createOrReplaceEmailVerificationToken(target.id);
    const originalHash = (await prisma.emailVerificationToken.findUnique({ where: { userId: target.id } }))!.tokenHash;
    await assert.rejects(() => changeUnverifiedUserEmail(target.id, owner.email), EmailChangeDuplicateEmailError);
    const unchanged = await prisma.user.findUnique({ where: { id: target.id } });
    assert.equal(unchanged?.email, target.email);
    assert.equal((await prisma.emailVerificationToken.findUnique({ where: { userId: target.id } }))?.tokenHash, originalHash);
    assert.ok(token.rawToken);
  });
});
