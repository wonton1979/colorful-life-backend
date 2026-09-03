import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { prisma } from "../prisma/runtime.js";

interface JwtPayload {
  id: number;
  role: string;
  iat: number;
  exp: number;
}

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    const user = await prisma.user.findUnique({ where: { id: payload.id }, select: { id: true, role: true, deletedAt: true } });
    if (!user || user.deletedAt !== null) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
