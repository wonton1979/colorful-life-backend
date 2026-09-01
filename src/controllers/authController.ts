import { Request, Response } from "express";
import { signupSchema, loginSchema, verifyEmailSchema } from "../utils/authValidation.js";
import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import { Prisma } from "../generated/prisma-client/client.js";
import { prisma } from "../prisma/runtime.js";
import { config } from "../config/index.js";
import { createOrReplaceEmailVerificationToken, verifyEmailVerificationToken } from "../domain/auth/emailVerificationService.js";
import { InvalidOrExpiredVerificationTokenError } from "../domain/auth/emailVerificationErrors.js";
import { sendVerificationEmail } from "../services/emailService.js";


export const signup = async (req: Request, res: Response) => {
  const parseResult = signupSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }
  const { email, password } = parseResult.data;
  // `email` is already normalized by the Zod schema via trim+lowercase
  const normalizedEmail = email;
  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const persistence = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash: hashedPassword,
        },
      });
      const verification = await createOrReplaceEmailVerificationToken(
        user.id,
        new Date(),
        tx,
      );
      return { user, verification };
    });
    const { user, verification } = persistence;
    if (verification.created) {
      const verificationUrl = `${config.FRONTEND_URL}/verify-email?token=${encodeURIComponent(verification.rawToken)}`;
      try {
        await sendVerificationEmail({ recipientEmail: user.email, verificationUrl });
      } catch (emailError) {
        console.error("Verification email delivery failed", emailError instanceof Error ? emailError.message : "unknown error");
      }
    }
    const token = jwt.sign(
      { id: user.id, role: user.role },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN } as SignOptions
    );
    return res.status(201).json({ token });
   } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // For the current schema the unique constraint violation on User.email
        // surfaces as a P2002 error with meta.modelName === "User".
        if (err.meta?.modelName === "User") {
          return res.status(409).json({ error: "Email already in use" });
        }
      }
     console.error("Signup error", err);
     return res.status(500).json({ error: "Internal server error" });
   }
};

export const login = async (req: Request, res: Response) => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }
  const { email, password } = parseResult.data;
  const normalizedEmail = email;
  try {
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign(
      { id: user.id, role: user.role },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN } as SignOptions
    );
    return res.json({ token });
  } catch (err) {
    console.error("Login error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const verifyEmail = async (req: Request, res: Response) => {
  const parseResult = verifyEmailSchema.safeParse(req.body);
  if (!parseResult.success) return res.status(400).json({ error: parseResult.error.format() });
  try {
    await verifyEmailVerificationToken(parseResult.data.token);
    return res.status(200).json({ message: "Email verified successfully" });
  } catch (err) {
    if (err instanceof InvalidOrExpiredVerificationTokenError) {
      return res.status(400).json({ error: "Invalid or expired verification token" });
    }
    console.error("Email verification error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const resendVerification = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, emailVerified: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.emailVerified) {
      const verification = await createOrReplaceEmailVerificationToken(user.id);
      if (verification.created) {
        const verificationUrl = `${config.FRONTEND_URL}/verify-email?token=${encodeURIComponent(verification.rawToken)}`;
        try {
          await sendVerificationEmail({ recipientEmail: user.email, verificationUrl });
        } catch (emailError) {
          console.error("Verification email delivery failed", emailError instanceof Error ? emailError.message : "unknown error");
        }
      }
    }
    return res.status(200).json({ message: "If verification is required, a verification email has been sent" });
  } catch (err) {
    console.error("Verification resend error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
