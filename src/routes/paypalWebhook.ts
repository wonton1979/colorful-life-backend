import { Router } from "express";
import express from "express";
import { paypalWebhookHandler } from "../controllers/paypalWebhookController.js";
const router = Router();
router.post("/paypal/webhook", express.raw({ type: "application/json" }), paypalWebhookHandler);
export default router;
