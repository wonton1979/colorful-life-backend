import { Router, type NextFunction, type Request, type Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { createAdminProductsController } from "../controllers/adminProducts.js";
import { sendApiError } from "../utils/apiErrorResponse.js";

const router = Router();
const controller = createAdminProductsController();

const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== "ADMIN") return sendApiError(res, 403, "FORBIDDEN", "Forbidden: ADMIN only");
  next();
};

router.get("/", authMiddleware, adminOnly, controller.search);
router.get("/product-availability", authMiddleware, adminOnly, controller.productAvailabilitySummary);
router.patch("/:productId", authMiddleware, adminOnly, controller.update);

export default router;
