"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const env_js_1 = require("./config/env.js");
const liaRouter_js_1 = require("./lia/liaRouter.js");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "al-e-core", timestamp: new Date().toISOString() });
});
app.use("/lia", liaRouter_js_1.liaRouter);
app.listen(env_js_1.env.port, "0.0.0.0", () => {
    console.log(`AL-E Core escuchando en ${env_js_1.env.port}`);
});
