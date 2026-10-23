"use strict";

const http = require("node:http");
const { validateContract } = require("./validate");
const { parseListQuery, queryContracts, expiringContracts, contractStats } = require("./query");

const MAX_BODY_BYTES = 1024 * 1024;

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sendJson(res, status, body, headers = {}) {
  if (status === 204) {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => {
      if (size > MAX_BODY_BYTES) {
        return reject(new HttpError(413, "PayloadTooLarge", "Request body must be smaller than 1 MB"));
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return reject(new HttpError(400, "InvalidJson", "Request body is empty"));
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return reject(new HttpError(400, "InvalidJson", "Request body is not valid JSON"));
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return reject(new HttpError(400, "InvalidBody", "Request body must be a JSON object"));
      }
      resolve(parsed);
    });
  });
}

function toErrorList(errors) {
  return errors.map(({ field, message }) => ({ field, message }));
}

function route(method, path, handler) {
  const names = [];
  const pattern = path.replace(/:(\w+)/g, (_, name) => {
    names.push(name);
    return "([^/]+)";
  });
  return { method, names, regex: new RegExp(`^${pattern}$`), handler };
}

/**
 * Build the HTTP server. `now` and `logger` can be injected, which keeps the
 * date-dependent endpoints and the request log easy to test.
 */
function createApp(store, { now = () => new Date(), logger = null } = {}) {
  const loadContract = (id) => {
    const contract = store.get(id);
    if (!contract) throw new HttpError(404, "NotFound", `Contract ${id} not found`);
    return contract;
  };

  const validated = (input) => {
    const { errors, data } = validateContract(input);
    if (errors.length) throw new HttpError(400, "ValidationError", "The contract is invalid", toErrorList(errors));
    return data;
  };

  const routes = [
    route("GET", "/health", () => ({
      status: 200,
      body: { status: "ok", uptimeSeconds: Math.round(process.uptime()) },
    })),

    route("GET", "/stats", () => ({ status: 200, body: contractStats(store.all()) })),

    route("GET", "/contracts/expiring", ({ url }) => {
      const errors = [];
      let days = 30;
      if (url.searchParams.has("days")) {
        days = Number(url.searchParams.get("days"));
        if (!Number.isInteger(days) || days < 1 || days > 365) {
          errors.push({ field: "days", message: "must be an integer between 1 and 365" });
        }
      }
      if (errors.length) throw new HttpError(400, "InvalidQuery", "Invalid query parameters", errors);
      const today = now().toISOString().slice(0, 10);
      const data = expiringContracts(store.all(), today, days);
      return { status: 200, body: { data, meta: { today, days, total: data.length } } };
    }),

    route("GET", "/contracts", ({ url }) => {
      const { errors, options } = parseListQuery(url.searchParams);
      if (errors.length) throw new HttpError(400, "InvalidQuery", "Invalid query parameters", errors);
      return { status: 200, body: queryContracts(store.all(), options) };
    }),

    route("POST", "/contracts", async ({ req }) => {
      const created = store.create(validated(await readJson(req)));
      return { status: 201, body: created, headers: { Location: `/contracts/${created.id}` } };
    }),

    route("GET", "/contracts/:id", ({ params }) => ({ status: 200, body: loadContract(params.id) })),

    route("PUT", "/contracts/:id", async ({ req, params }) => {
      loadContract(params.id);
      return { status: 200, body: store.replace(params.id, validated(await readJson(req))) };
    }),

    route("PATCH", "/contracts/:id", async ({ req, params }) => {
      const { id, createdAt, updatedAt, ...current } = loadContract(params.id);
      const changes = await readJson(req);
      // Merge first, then validate the whole contract so cross-field rules still apply.
      return { status: 200, body: store.replace(params.id, validated({ ...current, ...changes })) };
    }),

    route("DELETE", "/contracts/:id", ({ params }) => {
      loadContract(params.id);
      store.remove(params.id);
      return { status: 204 };
    }),
  ];

  async function dispatch(req, res) {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const candidates = routes.filter((r) => r.regex.test(pathname));
    if (candidates.length === 0) throw new HttpError(404, "NotFound", `No route for ${pathname}`);

    const matched = candidates.find((r) => r.method === req.method);
    if (!matched) {
      const allowed = [...new Set(candidates.map((r) => r.method))].join(", ");
      const error = new HttpError(405, "MethodNotAllowed", `${req.method} is not allowed here`);
      error.headers = { Allow: allowed };
      throw error;
    }

    const values = matched.regex.exec(pathname).slice(1);
    const params = {};
    for (const [index, name] of matched.names.entries()) {
      try {
        params[name] = decodeURIComponent(values[index]);
      } catch {
        throw new HttpError(400, "InvalidPath", "The URL contains invalid characters");
      }
    }

    const result = await matched.handler({ req, url, params });
    sendJson(res, result.status, result.body, result.headers);
  }

  return http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      await dispatch(req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(
          res,
          error.status,
          { error: error.code, message: error.message, ...(error.details && { details: error.details }) },
          error.headers
        );
      } else {
        logger?.(`unexpected error: ${error.stack}`);
        sendJson(res, 500, { error: "InternalServerError", message: "Something went wrong" });
      }
    }
    logger?.(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
  });
}

module.exports = { createApp, HttpError };
