import { Router, type NextFunction, type Request, type Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { createAdminProductsController } from "../controllers/adminProducts.js";

const router = Router();
const controller = createAdminProductsController();

const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Forbidden: ADMIN only" });
  next();
};

router.get("/", authMiddleware, adminOnly, controller.search);
router.patch("/:productId", authMiddleware, adminOnly, controller.update);

export default router;
