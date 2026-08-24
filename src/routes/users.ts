import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { getCurrentUserProfile, updateCurrentUserProfile } from "../controllers/userProfile.js";

const router = Router();

router.get("/me", authMiddleware, getCurrentUserProfile);
router.patch("/me", authMiddleware, updateCurrentUserProfile);

export default router;
