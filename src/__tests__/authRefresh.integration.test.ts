import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { config } from "../config/index.js";
import { prisma } from "../prisma/runtime.js";
import { hashRefreshToken } from "../domain/auth/refreshSessionService.js";
import { setRefreshSessionRotationForTests } from "../controllers/authController.js";

const userIds: number[] = [];
const restores: Array<() => void> = [];
let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  while (restores.length) restores.pop()!();
  if (userIds.length) {
    await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
  }
});

after(async () => {
  await prisma.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function makeUser(role: "ADMIN" | "CUSTOMER" = "CUSTOMER") {
  const user = await prisma.user.create({ data: {
    email: `${randomUUID()}@example.test`,
    passwordHash: await bcrypt.hash("StrongPass1!", 4),
    emailVerified: true,
    role,
  } });
  userIds.push(user.id);
  return user;
}

async function post(path: string, body: unknown, authorization?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const responseBody = response.status === 204 ? undefined : await response.json();
  return { response, body: responseBody };
}

async function login(role: "ADMIN" | "CUSTOMER" = "CUSTOMER") {
  const user = await makeUser(role);
  const { response, body } = await post("/auth/login", { email: user.email, password: "StrongPass1!" });
  assert.equal(response.status, 200);
  return { user, body };
}

function sessionInvalid(body: unknown) {
  assert.deepEqual(body, { error: { code: "SESSION_INVALID", message: "Invalid or expired token" } });
}

describe("renewable authentication sessions", () => {
  it("login returns a valid access token, explicit expiries, and only stores the refresh-token hash", async () => {
    const { user, body } = await login();
    assert.equal(typeof body.token, "string");
    assert.equal(typeof body.accessTokenExpiresAt, "string");
    assert.equal(typeof body.refreshToken, "string");
    assert.match(body.refreshToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(typeof body.refreshExpiresAt, "string");

    const decoded = jwt.verify(body.token, config.JWT_SECRET) as jwt.JwtPayload & { id: number; role: string };
    assert.equal(decoded.id, user.id);
    assert.equal(decoded.role, "CUSTOMER");
    assert.equal(new Date(decoded.exp! * 1000).toISOString(), body.accessTokenExpiresAt);
    assert.ok(new Date(body.refreshExpiresAt).getTime() > Date.now());
    assert.equal(new Date(body.refreshExpiresAt).getTime() - Date.now() < (config.REFRESH_SESSION_TTL_DAYS + 1) * 86_400_000, true);

    const session = await prisma.refreshSession.findUnique({ where: { refreshTokenHash: hashRefreshToken(body.refreshToken) } });
    assert.ok(session);
    assert.equal(session.userId, user.id);
    assert.notEqual(session.refreshTokenHash, body.refreshToken);
    assert.equal(await prisma.refreshSession.findUnique({ where: { refreshTokenHash: body.refreshToken } }), null);

    const profile = await fetch(`${baseUrl}/profile`, { headers: { Authorization: `Bearer ${body.token}` } });
    assert.equal(profile.status, 200, "the login access JWT remains usable by normal authenticated APIs");
  });

  it("refresh works with an expired access JWT, rotates the credential, and does not need a password", async () => {
    const { user, body: loggedIn } = await login();
    const expiredAccessToken = jwt.sign({ id: user.id, role: "CUSTOMER" }, config.JWT_SECRET, { expiresIn: "-1s" });
    const first = await post("/auth/refresh", { refreshToken: loggedIn.refreshToken }, `Bearer ${expiredAccessToken}`);
    assert.equal(first.response.status, 200);
    assert.ok(first.body.token);
    assert.notEqual(first.body.refreshToken, loggedIn.refreshToken);
    assert.equal(first.body.accessTokenExpiresAt, new Date((jwt.decode(first.body.token) as jwt.JwtPayload).exp! * 1000).toISOString());
    assert.equal(first.body.refreshExpiresAt, loggedIn.refreshExpiresAt, "the absolute refresh-session expiry does not slide");

    assert.equal(await prisma.refreshSession.findUnique({ where: { refreshTokenHash: hashRefreshToken(loggedIn.refreshToken) } }), null);
    assert.ok(await prisma.refreshSession.findUnique({ where: { refreshTokenHash: hashRefreshToken(first.body.refreshToken) } }));
    sessionInvalid((await post("/auth/refresh", { refreshToken: loggedIn.refreshToken })).body);

    const second = await post("/auth/refresh", { refreshToken: first.body.refreshToken });
    assert.equal(second.response.status, 200, "the newly rotated credential remains usable");
    assert.notEqual(second.body.refreshToken, first.body.refreshToken);
  });

  it("rejects missing, malformed, unknown, and expired renewable credentials", async () => {
    const missing = await post("/auth/refresh", {});
    assert.equal(missing.response.status, 401);
    assert.deepEqual(missing.body, { error: { code: "AUTH_REQUIRED", message: "Refresh token is required" } });

    const malformed = await post("/auth/refresh", { refreshToken: "not-a-refresh-token" });
    assert.equal(malformed.response.status, 401);
    sessionInvalid(malformed.body);

    const unknown = await post("/auth/refresh", { refreshToken: "x".repeat(43) });
    assert.equal(unknown.response.status, 401);
    sessionInvalid(unknown.body);

    const { body: loggedIn } = await login();
    await prisma.refreshSession.update({
      where: { refreshTokenHash: hashRefreshToken(loggedIn.refreshToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await post("/auth/refresh", { refreshToken: loggedIn.refreshToken });
    assert.equal(expired.response.status, 401);
    sessionInvalid(expired.body);
  });

  it("refresh loads current user state and never restores a stale ADMIN role", async () => {
    const { user, body: loggedIn } = await login("ADMIN");
    await prisma.user.update({ where: { id: user.id }, data: { role: "CUSTOMER" } });
    const renewed = await post("/auth/refresh", { refreshToken: loggedIn.refreshToken });
    assert.equal(renewed.response.status, 200);
    assert.equal((jwt.decode(renewed.body.token) as jwt.JwtPayload).role, "CUSTOMER");

    const adminRequest = await fetch(`${baseUrl}/admin/product-listings`, {
      headers: { Authorization: `Bearer ${renewed.body.token}` },
    });
    assert.equal(adminRequest.status, 403);
    assert.deepEqual(await adminRequest.json(), { error: { code: "FORBIDDEN", message: "Forbidden: ADMIN only" } });
  });

  it("does not renew a soft-deleted user and maps database failures to 500", async () => {
    const { user, body: loggedIn } = await login();
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    const deleted = await post("/auth/refresh", { refreshToken: loggedIn.refreshToken });
    assert.equal(deleted.response.status, 401);
    sessionInvalid(deleted.body);

    restores.push(setRefreshSessionRotationForTests(async () => { throw new Error("database unavailable"); }));
    const databaseFailure = await post("/auth/refresh", { refreshToken: "y".repeat(43) });
    assert.equal(databaseFailure.response.status, 500);
    assert.deepEqual(databaseFailure.body, { error: { code: "INTERNAL_SERVER_ERROR", message: "Internal server error" } });
    assert.notEqual(databaseFailure.body.error.code, "SESSION_INVALID");
  });

  it("logout revokes the renewable session idempotently and refresh after logout fails", async () => {
    const { body: loggedIn } = await login();
    const logout = await post("/auth/logout", { refreshToken: loggedIn.refreshToken });
    assert.equal(logout.response.status, 204);
    assert.equal(logout.body, undefined);
    const repeatedLogout = await post("/auth/logout", { refreshToken: loggedIn.refreshToken });
    assert.equal(repeatedLogout.response.status, 204);

    const session = await prisma.refreshSession.findUnique({ where: { refreshTokenHash: hashRefreshToken(loggedIn.refreshToken) } });
    assert.ok(session?.revokedAt);
    const refreshed = await post("/auth/refresh", { refreshToken: loggedIn.refreshToken });
    assert.equal(refreshed.response.status, 401);
    sessionInvalid(refreshed.body);

    const noTokenLogout = await post("/auth/logout", {});
    assert.equal(noTokenLogout.response.status, 401);
    assert.deepEqual(noTokenLogout.body, { error: { code: "AUTH_REQUIRED", message: "Refresh token is required" } });
  });

  it("allows only one concurrent rotation of the same refresh credential", async () => {
    const { body: loggedIn } = await login();
    const responses = await Promise.all([
      post("/auth/refresh", { refreshToken: loggedIn.refreshToken }),
      post("/auth/refresh", { refreshToken: loggedIn.refreshToken }),
    ]);
    assert.equal(responses.filter(({ response }) => response.status === 200).length, 1);
    assert.equal(responses.filter(({ response }) => response.status === 401).length, 1);
    const success = responses.find(({ response }) => response.status === 200)!;
    const failure = responses.find(({ response }) => response.status === 401)!;
    sessionInvalid(failure.body);
    const followup = await post("/auth/refresh", { refreshToken: success.body.refreshToken });
    assert.equal(followup.response.status, 200);
  });
});
