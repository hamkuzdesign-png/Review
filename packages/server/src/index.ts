import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health";
import { compareWebRouter } from "./routes/compareWeb";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

app.use(healthRouter);
app.use(compareWebRouter);

const PORT = Number(process.env.PORT) || 4517;
// 127.0.0.1 only accepts connections from inside the same machine — fine for
// local dev, but a deployed container's traffic arrives from outside it, so
// the process needs to bind every interface. HOST stays overridable in case
// a host wants something more restrictive.
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`Design-diff backend listening on http://${HOST}:${PORT}`);
});
