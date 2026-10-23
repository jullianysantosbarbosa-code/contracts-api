"use strict";

const { createApp } = require("../src/app");
const { ContractStore } = require("../src/store");

const TODAY = "2025-06-15";

const sample = {
  title: "Cloud hosting 2025",
  supplier: "Atlas Cloud Services",
  value: 48000,
  startDate: "2025-01-01",
  endDate: "2025-12-31",
};

/** Start a fresh server on a random port and hand `fn` a small HTTP client. */
async function withApp(fn, { store = new ContractStore() } = {}) {
  const server = createApp(store, { now: () => new Date(`${TODAY}T10:00:00Z`) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, body) => {
    const hasBody = body !== undefined;
    const response = await fetch(base + path, {
      method,
      headers: hasBody ? { "Content-Type": "application/json" } : {},
      body: hasBody ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  };

  try {
    await fn(call, store);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { withApp, sample, TODAY };
