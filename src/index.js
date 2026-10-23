"use strict";

const { createApp } = require("./app");
const { ContractStore } = require("./store");

const port = Number(process.env.PORT) || 3000;
const store = new ContractStore({ filePath: process.env.DATA_FILE || null });
const server = createApp(store, { logger: console.log });

server.listen(port, () => {
  console.log(`contracts-api listening on http://localhost:${port}`);
  if (process.env.DATA_FILE) console.log(`persisting data to ${process.env.DATA_FILE}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
