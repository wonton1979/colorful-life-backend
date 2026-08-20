import express from "express";
import authRouter from "./routes/auth.js";
import profileRouter from "./routes/profile.js";
import productsRouter from "./routes/products.js";
import purchasesRouter from "./routes/purchases.js";

// Construct the Express application without starting the HTTP server.
const app = express();

app.use(express.json());
// Mount routers
app.use("/auth", authRouter);
app.use("/", profileRouter);
app.use("/products", productsRouter);
app.use("/purchases", purchasesRouter);

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;
