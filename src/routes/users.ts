import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireVerifiedEmail } from "../middleware/requireVerifiedEmail.js";
import { getCurrentUserProfile, updateCurrentUserProfile } from "../controllers/userProfile.js";
import {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
} from "../controllers/addressController.js";

const router = Router();

router.get("/me", authMiddleware, requireVerifiedEmail, getCurrentUserProfile);
router.patch("/me", authMiddleware, requireVerifiedEmail, updateCurrentUserProfile);
// Address management endpoints
router.get("/me/addresses", authMiddleware, requireVerifiedEmail, getAddresses);
router.post("/me/addresses", authMiddleware, requireVerifiedEmail, createAddress);
router.patch("/me/addresses/:addressId", authMiddleware, requireVerifiedEmail, updateAddress);
router.delete("/me/addresses/:addressId", authMiddleware, requireVerifiedEmail, deleteAddress);

export default router;
