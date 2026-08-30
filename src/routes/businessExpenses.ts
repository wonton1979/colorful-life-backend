import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { createBusinessExpense, listBusinessExpenses } from "../controllers/businessExpenses.js";

const router = Router();

router.post("/", authMiddleware, createBusinessExpense);
router.get("/", authMiddleware, listBusinessExpenses);

export default router;
