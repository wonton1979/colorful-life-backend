import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { getCurrentUserProfile, updateCurrentUserProfile } from "../controllers/userProfile.js";
import {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
} from "../controllers/addressController.js";

const router = Router();

router.get("/me", authMiddleware, getCurrentUserProfile);
router.patch("/me", authMiddleware, updateCurrentUserProfile);
// Address management endpoints
router.get("/me/addresses", authMiddleware, getAddresses);
router.post("/me/addresses", authMiddleware, createAddress);
router.patch("/me/addresses/:addressId", authMiddleware, updateAddress);
router.delete("/me/addresses/:addressId", authMiddleware, deleteAddress);

export default router;
