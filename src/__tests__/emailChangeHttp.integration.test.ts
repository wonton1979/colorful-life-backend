import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, afterEach, before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import app from "../app.js";
import { config } from "../config/index.js";
import { prisma } from "../prisma/runtime.js";
import { setVerificationEmailSenderForTests } from "../services/emailService.js";
import { createOrReplaceEmailVerificationToken, hashEmailVerificationToken, verifyEmailVerificationToken } from "../domain/auth/emailVerificationService.js";

describe("email change HTTP", () => {
  let server: Server; let baseUrl: string; let restore: (() => void) | undefined;
  const ids: number[] = [];
  before(async () => { server = app.listen(0); await new Promise<void>((resolve) => server.once("listening", resolve)); baseUrl = `http://localhost:${(server.address() as { port: number }).port}`; });
  after(async () => { restore?.(); await prisma.user.deleteMany({ where: { id: { in: ids } } }); await new Promise<void>((resolve) => server.close(() => resolve())); });
  afterEach(() => { restore?.(); restore = undefined; });
  async function makeUser(emailVerified = false) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, passwordHash: await bcrypt.hash("Abcdef1!", 4), emailVerified } }); ids.push(user.id); return user;
  }
  function token(id: number) { return jwt.sign({ id, role: "CUSTOMER" }, config.JWT_SECRET, { expiresIn: "1h" }); }
  async function change(userId: number, email: string) {
    return fetch(`${baseUrl}/users/me/email`, { method: "PATCH", headers: { Authorization: `Bearer ${token(userId)}`, "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  }
  it("requires authentication and changes an unverified user's email", async () => {
    assert.equal((await fetch(`${baseUrl}/users/me/email`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "new@example.com" }) })).status, 401);
    const user = await makeUser(); const sent: { recipientEmail: string; verificationUrl: string }[] = [];
    restore = setVerificationEmailSenderForTests(async (email) => { sent.push(email); });
    const response = await fetch(`${baseUrl}/users/me/email`, { method: "PATCH", headers: { Authorization: `Bearer ${token(user.id)}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: "  NEW@EXAMPLE.COM " }) });
    assert.equal(response.status, 200); assert.equal((await prisma.user.findUnique({ where: { id: user.id } }))?.email, "new@example.com");
    assert.equal(sent[0].recipientEmail, "new@example.com"); const raw = new URL(sent[0].verificationUrl).searchParams.get("token")!; const stored = await prisma.emailVerificationToken.findUnique({ where: { userId: user.id } }); assert.equal(stored?.tokenHash, hashEmailVerificationToken(raw));
    await verifyEmailVerificationToken(raw); assert.equal((await prisma.user.findUnique({ where: { id: user.id } }))?.emailVerified, true);
  });
  it("rejects verified and same-email changes", async () => {
    const verified = await makeUser(true); const same = await fetch(`${baseUrl}/users/me/email`, { method: "PATCH", headers: { Authorization: `Bearer ${token(verified.id)}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: verified.email }) }); assert.equal(same.status, 400);
    const unverified = await makeUser(); const unchanged = await fetch(`${baseUrl}/users/me/email`, { method: "PATCH", headers: { Authorization: `Bearer ${token(unverified.id)}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: unverified.email.toUpperCase() }) }); assert.equal(unchanged.status, 400);
  });

  it("rejects malformed email without changing the user, token, or sending mail", async () => {
    const user = await makeUser(); const existing = await createOrReplaceEmailVerificationToken(user.id);
    let sent = 0; restore = setVerificationEmailSenderForTests(async () => { sent += 1; });
    const response = await change(user.id, "not-an-email");
    assert.equal(response.status, 400); assert.equal(sent, 0);
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } }))?.email, user.email);
    assert.equal((await prisma.emailVerificationToken.findUnique({ where: { userId: user.id } }))?.tokenHash, hashEmailVerificationToken(existing.rawToken!));
  });

  it("returns only a minimal success response", async () => {
    const user = await makeUser(); restore = setVerificationEmailSenderForTests(async () => {});
    const response = await change(user.id, "minimal@example.com");
    assert.equal(response.status, 200); const body = JSON.stringify(await response.json());
    for (const secret of ["rawToken", "tokenHash", "passwordHash", "role"]) assert.equal(body.includes(secret), false);
  });

  it("rejects duplicate email and rolls back the target email and token", async () => {
    const owner = await makeUser(); const target = await makeUser(); const existing = await createOrReplaceEmailVerificationToken(target.id);
    let sent = 0; restore = setVerificationEmailSenderForTests(async () => { sent += 1; });
    const response = await change(target.id, owner.email);
    assert.equal(response.status, 409); assert.equal(sent, 0);
    assert.equal((await prisma.user.findUnique({ where: { id: target.id } }))?.email, target.email);
    assert.equal((await prisma.user.findUnique({ where: { id: target.id } }))?.emailVerified, false);
    assert.equal((await prisma.emailVerificationToken.findUnique({ where: { userId: target.id } }))?.tokenHash, hashEmailVerificationToken(existing.rawToken!));
  });

  it("keeps the committed change when verification email delivery fails", async () => {
    const user = await makeUser(); restore = setVerificationEmailSenderForTests(async () => { throw new Error("SES unavailable"); });
    const response = await change(user.id, "delivery-failure@example.com");
    assert.equal(response.status, 200);
    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(updated?.email, "delivery-failure@example.com"); assert.equal(updated?.emailVerified, false);
    assert.ok(await prisma.emailVerificationToken.findUnique({ where: { userId: user.id } }));
  });

  it("resends to the corrected current email", async () => {
    const user = await makeUser(); const sent: { recipientEmail: string }[] = [];
    restore = setVerificationEmailSenderForTests(async (email) => { sent.push(email); });
    assert.equal((await change(user.id, "corrected@example.com")).status, 200);
    const resend = await fetch(`${baseUrl}/auth/resend-verification`, { method: "POST", headers: { Authorization: `Bearer ${token(user.id)}` } });
    assert.equal(resend.status, 200); assert.equal(sent.at(-1)?.recipientEmail, "corrected@example.com");
  });

  it("uses current database verification state rather than JWT state", async () => {
    const user = await makeUser(); const jwtToken = token(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    const response = await fetch(`${baseUrl}/users/me/email`, { method: "PATCH", headers: { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: "should-fail@example.com" }) });
    assert.equal(response.status, 400); assert.equal((await prisma.user.findUnique({ where: { id: user.id } }))?.email, user.email);
  });
});
