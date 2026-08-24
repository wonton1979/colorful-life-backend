import { Request, Response } from "express";
import { prisma } from "../prisma/runtime.js";
import { Prisma } from "../generated/prisma-client/client.js";
import { z } from "zod";

// ----- Zod validation for PATCH /users/me -----
const UpdateProfileSchema = z.object({
  firstName: z.string().trim().min(1, { message: "firstName cannot be empty" }).optional(),
  lastName: z.string().trim().min(1, { message: "lastName cannot be empty" }).optional(),
  phone: z.string().trim().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "No fields provided for update",
});

// ----- GET /users/me -----
export const getCurrentUserProfile = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
      },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json(user);
  } catch (err) {
    console.error("Get current user profile error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ----- PATCH /users/me -----
export const updateCurrentUserProfile = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const parseResult = UpdateProfileSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }
  const { firstName, lastName, phone } = parseResult.data;
  const updateData: Prisma.UserUpdateInput = {};
  if (firstName !== undefined) updateData.firstName = firstName;
  if (lastName !== undefined) updateData.lastName = lastName;
  if (phone !== undefined) updateData.phone = phone;
  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
      },
    });
    return res.json(updatedUser);
  } catch (err) {
    console.error("Update user profile error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
