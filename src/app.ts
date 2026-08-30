import express from "express";
import authRouter from "./routes/auth.js";
import profileRouter from "./routes/profile.js";
import usersRouter from "./routes/users.js";
import productsRouter from "./routes/products.js";
import purchasesRouter from "./routes/purchases.js";
import purchaseItemsRouter from "./routes/purchaseItems.js";
import ordersRouter from "./routes/orders.js";
import businessExpensesRouter from "./routes/businessExpenses.js";

// Construct the Express application without starting the HTTP server.
const app = express();

app.use(express.json());
// Mount routers
app.use("/auth", authRouter);
app.use("/", profileRouter);
app.use("/users", usersRouter);
app.use("/products", productsRouter);
app.use("/purchases", purchasesRouter);
app.use("/purchase-items", purchaseItemsRouter);
app.use("/orders", ordersRouter);
app.use("/business-expenses", businessExpensesRouter);

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;
