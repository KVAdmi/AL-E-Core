import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { liaRouter } from "./lia/liaRouter.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
	res.json({ status: "ok", service: "al-e-core", timestamp: new Date().toISOString() });
});

app.use("/lia", liaRouter);

app.listen(env.port, () => {
	console.log(`AL-E Core listening on port ${env.port}`);
});
