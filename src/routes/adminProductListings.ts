import { Router, type NextFunction, type Request, type Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { createAdminProductListingsController } from "../controllers/adminProductListings.js";
import { sendApiError } from "../utils/apiErrorResponse.js";

const router = Router();
const controller = createAdminProductListingsController();

const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== "ADMIN") return sendApiError(res, 403, "FORBIDDEN", "Forbidden: ADMIN only");
  next();
};

router.get("/", authMiddleware, adminOnly, controller.list);

export default router;
