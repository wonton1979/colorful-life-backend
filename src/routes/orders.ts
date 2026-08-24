import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { createOrderHandler } from "../controllers/orders.js";

const router = Router();

router.post("/", authMiddleware, createOrderHandler);

export default router;
