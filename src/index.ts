import express from "express";
import authRouter from "./routes/auth.js";
import profileRouter from "./routes/profile.js";
import productsRouter from "./routes/products.js";
// Import the configuration from the config directory. Adding the .js extension
// ensures that Node resolves the module correctly when running the compiled
// JavaScript. This is required for Node 22+ when "moduleResolution" is set
// to "bundler".
import { config } from "./config/index.js";

const app = express();
app.use(express.json());
// Mount authentication routes
app.use("/auth", authRouter);
// Mount profile routes at root to expose GET /profile
app.use("/", profileRouter);
app.use("/products", productsRouter);

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const PORT = config.PORT;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

export default app;