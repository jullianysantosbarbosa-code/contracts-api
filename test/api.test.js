"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { withApp, sample } = require("./helpers");

const make = (overrides) => ({ ...sample, ...overrides });

describe("basics", () => {
  test("health check", () =>
    withApp(async (call) => {
      const res = await call("GET", "/health");
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "ok");
    }));

  test("unknown route returns 404 JSON", () =>
    withApp(async (call) => {
      const res = await call("GET", "/nope");
      assert.equal(res.status, 404);
      assert.equal(res.body.error, "NotFound");
    }));

  test("wrong method returns 405 with an Allow header", () =>
    withApp(async (call) => {
      const res = await call("DELETE", "/contracts");
      assert.equal(res.status, 405);
      assert.equal(res.headers.get("allow"), "GET, POST");
    }));
});

describe("create and read", () => {
  test("POST creates a contract with defaults and a Location header", () =>
    withApp(async (call) => {
      const res = await call("POST", "/contracts", sample);
      assert.equal(res.status, 201);
      assert.equal(res.body.status, "draft");
      assert.equal(res.body.currency, "EUR");
      assert.match(res.body.id, /^[0-9a-f-]{36}$/);
      assert.equal(res.headers.get("location"), `/contracts/${res.body.id}`);

      const fetched = await call("GET", res.headers.get("location"));
      assert.equal(fetched.status, 200);
      assert.deepEqual(fetched.body, res.body);
    }));

  test("POST rejects invalid data and lists every problem", () =>
    withApp(async (call) => {
      const res = await call("POST", "/contracts", { title: "x", value: -5 });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "ValidationError");
      const fields = res.body.details.map((d) => d.field);
      assert.ok(fields.includes("title") && fields.includes("value") && fields.includes("supplier"));
    }));

  test("POST rejects malformed JSON, empty bodies and non-objects", () =>
    withApp(async (call) => {
      assert.equal((await call("POST", "/contracts", "{not json")).body.error, "InvalidJson");
      assert.equal((await call("POST", "/contracts", "   ")).body.error, "InvalidJson");
      assert.equal((await call("POST", "/contracts", "[1,2]")).body.error, "InvalidBody");
    }));

  test("GET of an unknown id returns 404", () =>
    withApp(async (call) => {
      const res = await call("GET", "/contracts/does-not-exist");
      assert.equal(res.status, 404);
    }));
});

describe("update and delete", () => {
  test("PUT replaces the whole contract", () =>
    withApp(async (call) => {
      const { body: created } = await call("POST", "/contracts", sample);
      const res = await call("PUT", `/contracts/${created.id}`, make({ title: "Renewed hosting", status: "active" }));
      assert.equal(res.status, 200);
      assert.equal(res.body.title, "Renewed hosting");
      assert.equal(res.body.createdAt, created.createdAt);
      assert.equal((await call("PUT", `/contracts/${created.id}`, { title: "only" })).status, 400);
      assert.equal((await call("PUT", "/contracts/missing", sample)).status, 404);
    }));

  test("PATCH changes only the given fields", () =>
    withApp(async (call) => {
      const { body: created } = await call("POST", "/contracts", sample);
      const res = await call("PATCH", `/contracts/${created.id}`, { status: "active" });
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "active");
      assert.equal(res.body.supplier, sample.supplier);
    }));

  test("PATCH still enforces cross-field rules", () =>
    withApp(async (call) => {
      const { body: created } = await call("POST", "/contracts", sample);
      const res = await call("PATCH", `/contracts/${created.id}`, { endDate: "2024-01-01" });
      assert.equal(res.status, 400);
      assert.equal(res.body.details[0].field, "endDate");
      assert.equal((await call("GET", `/contracts/${created.id}`)).body.endDate, sample.endDate);
    }));

  test("PATCH cannot overwrite the id", () =>
    withApp(async (call) => {
      const { body: created } = await call("POST", "/contracts", sample);
      const res = await call("PATCH", `/contracts/${created.id}`, { id: "hacked", title: "Still fine" });
      assert.equal(res.body.id, created.id);
    }));

  test("DELETE removes the contract", () =>
    withApp(async (call) => {
      const { body: created } = await call("POST", "/contracts", sample);
      assert.equal((await call("DELETE", `/contracts/${created.id}`)).status, 204);
      assert.equal((await call("GET", `/contracts/${created.id}`)).status, 404);
      assert.equal((await call("DELETE", `/contracts/${created.id}`)).status, 404);
    }));
});

describe("listing", () => {
  const seed = async (call) => {
    const items = [
      make({ title: "Cloud hosting", supplier: "Atlas Cloud Services", value: 48000, status: "active" }),
      make({ title: "Office cleaning", supplier: "Emerald Facilities Ltd", value: 9000, status: "active" }),
      make({ title: "Legal advice", supplier: "Liffey Consulting Group", value: 25000, status: "draft" }),
      make({ title: "Staff training", supplier: "Celtic Training Partners", value: 4000, status: "expired" }),
    ];
    for (const item of items) await call("POST", "/contracts", item);
  };

  test("filters by status, supplier and value range", () =>
    withApp(async (call) => {
      await seed(call);
      assert.equal((await call("GET", "/contracts?status=active")).body.meta.total, 2);
      assert.equal((await call("GET", "/contracts?supplier=ATLAS")).body.data[0].title, "Cloud hosting");
      const range = await call("GET", "/contracts?minValue=5000&maxValue=30000");
      assert.deepEqual(range.body.data.map((c) => c.title).sort(), ["Legal advice", "Office cleaning"]);
    }));

  test("sorts ascending and descending", () =>
    withApp(async (call) => {
      await seed(call);
      const asc = await call("GET", "/contracts?sort=value:asc");
      assert.deepEqual(asc.body.data.map((c) => c.value), [4000, 9000, 25000, 48000]);
      const desc = await call("GET", "/contracts?sort=value:desc");
      assert.equal(desc.body.data[0].value, 48000);
    }));

  test("paginates and reports metadata", () =>
    withApp(async (call) => {
      await seed(call);
      const res = await call("GET", "/contracts?sort=value&limit=3&page=2");
      assert.equal(res.body.data.length, 1);
      assert.deepEqual(res.body.meta, { total: 4, page: 2, limit: 3, pages: 2 });
    }));

  test("rejects invalid query parameters", () =>
    withApp(async (call) => {
      const res = await call("GET", "/contracts?status=paused&limit=500&sort=colour&minValue=abc");
      assert.equal(res.status, 400);
      const fields = res.body.details.map((d) => d.field).sort();
      assert.deepEqual(fields, ["limit", "minValue", "sort", "status"]);
    }));
});

describe("reports", () => {
  test("expiring lists active contracts ending within the window", () =>
    withApp(async (call) => {
      // "Today" is fixed at 2025-06-15 in the test helper.
      await call("POST", "/contracts", make({ title: "Ends soon", status: "active", endDate: "2025-06-20" }));
      await call("POST", "/contracts", make({ title: "Ends later", status: "active", endDate: "2025-08-01" }));
      await call("POST", "/contracts", make({ title: "Already ended", status: "active", endDate: "2025-06-01" }));
      await call("POST", "/contracts", make({ title: "Draft only", status: "draft", endDate: "2025-06-25" }));

      const res = await call("GET", "/contracts/expiring?days=30");
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.map((c) => c.title), ["Ends soon"]);
      assert.equal(res.body.data[0].daysRemaining, 5);
      assert.equal(res.body.meta.today, "2025-06-15");

      const wider = await call("GET", "/contracts/expiring?days=60");
      assert.deepEqual(wider.body.data.map((c) => c.title), ["Ends soon", "Ends later"]);
      assert.equal((await call("GET", "/contracts/expiring?days=0")).status, 400);
    }));

  test("stats summarise statuses and active value per currency", () =>
    withApp(async (call) => {
      await call("POST", "/contracts", make({ status: "active", value: 1000.5 }));
      await call("POST", "/contracts", make({ status: "active", value: 2000, currency: "USD" }));
      await call("POST", "/contracts", make({ status: "active", value: 499.5 }));
      await call("POST", "/contracts", make({ status: "draft", value: 99999 }));

      const res = await call("GET", "/stats");
      assert.equal(res.body.total, 4);
      assert.deepEqual(res.body.byStatus, { draft: 1, active: 3, expired: 0, terminated: 0 });
      assert.deepEqual(res.body.activeValueByCurrency, { EUR: 1500, USD: 2000 });
    }));
});
