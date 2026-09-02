import { Router } from "express";
import { signup, login, verifyEmail, resendVerification, forgotPassword, resetPasswordHandler } from "../controllers/authController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", authMiddleware, resendVerification);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPasswordHandler);

export default router;
