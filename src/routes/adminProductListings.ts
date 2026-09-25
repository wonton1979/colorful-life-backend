import { Router, type NextFunction, type Request, type Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { createAdminProductListingsController } from "../controllers/adminProductListings.js";

const router = Router();
const controller = createAdminProductListingsController();

const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Forbidden: ADMIN only" });
  next();
};

router.get("/", authMiddleware, adminOnly, controller.list);

export default router;
