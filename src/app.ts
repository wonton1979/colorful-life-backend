import express from "express";
import authRouter from "./routes/auth.js";
import profileRouter from "./routes/profile.js";
import usersRouter from "./routes/users.js";
import productsRouter from "./routes/products.js";
import purchasesRouter from "./routes/purchases.js";
import purchaseItemsRouter from "./routes/purchaseItems.js";
import ordersRouter from "./routes/orders.js";
import businessExpensesRouter from "./routes/businessExpenses.js";
import inventoryRouter from "./routes/inventory.js";
import stripeWebhookRouter from "./routes/stripeWebhook.js";
import paypalWebhookRouter from "./routes/paypalWebhook.js";
import cartRouter from "./routes/cart.js";
import cors from "cors";
import { createListingImagesRouter } from "./routes/listingImages.js";
import { createCatalogueArtworkRouter } from "./routes/catalogueArtwork.js";
import categoriesRouter from "./routes/categories.js";
import { createCategoryManagementRouter } from "./routes/categoryManagement.js";
import type { ImageStorage } from "./infrastructure/imageStorage/imageStorage.js";

export function createApp(imageStorage?: ImageStorage, catalogueArtworkStorage?: ImageStorage, categoryArtworkStorage?: ImageStorage) {
  const app = express();
  app.use(cors({ origin: "http://localhost:5173" }));
  app.use("/payments", stripeWebhookRouter);
  app.use("/payments", paypalWebhookRouter);
  app.use(express.json());
  app.use("/auth", authRouter);
  app.use("/", profileRouter);
  app.use("/users", usersRouter);
  app.use("/products", productsRouter);
  app.use("/products", createListingImagesRouter(imageStorage));
  app.use("/products", createCatalogueArtworkRouter(catalogueArtworkStorage ?? imageStorage));
  app.use("/categories", categoriesRouter);
  app.use("/admin/categories", createCategoryManagementRouter(categoryArtworkStorage));
  app.use("/purchases", purchasesRouter);
  app.use("/purchase-items", purchaseItemsRouter);
  app.use("/orders", ordersRouter);
  app.use("/cart", cartRouter);
  app.use("/business-expenses", businessExpensesRouter);
  app.use("/inventory", inventoryRouter);
  app.get("/health", (_req, res) => { res.json({ status: "ok" }); });
  return app;
}

export default createApp();
