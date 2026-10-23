"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isIsoDate, validateContract } = require("../src/validate");
const { sample } = require("./helpers");

test("accepts a valid contract and fills in defaults", () => {
  const { errors, data } = validateContract(sample);
  assert.deepEqual(errors, []);
  assert.equal(data.currency, "EUR");
  assert.equal(data.status, "draft");
});

test("trims text and drops unknown fields", () => {
  const { errors, data } = validateContract({ ...sample, title: "  Cloud hosting  ", admin: true });
  assert.deepEqual(errors, []);
  assert.equal(data.title, "Cloud hosting");
  assert.equal("admin" in data, false);
});

test("reports every invalid field at once", () => {
  const { errors } = validateContract({ title: "x", value: "12", startDate: "nope" });
  const fields = errors.map((e) => e.field);
  for (const field of ["title", "supplier", "value", "startDate", "endDate"]) {
    assert.ok(fields.includes(field), `expected an error for ${field}`);
  }
});

test("rejects negative and non-finite values", () => {
  assert.equal(validateContract({ ...sample, value: -1 }).errors[0].field, "value");
  assert.equal(validateContract({ ...sample, value: Infinity }).errors[0].field, "value");
});

test("rejects an end date before the start date", () => {
  const { errors } = validateContract({ ...sample, startDate: "2025-05-01", endDate: "2025-04-30" });
  assert.deepEqual(errors, [{ field: "endDate", message: "must not be before startDate" }]);
});

test("rejects unknown status and malformed currency", () => {
  const fields = validateContract({ ...sample, status: "paused", currency: "eur" }).errors.map((e) => e.field);
  assert.deepEqual(fields.sort(), ["currency", "status"]);
});

test("isIsoDate rejects impossible calendar dates", () => {
  assert.equal(isIsoDate("2025-02-28"), true);
  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(isIsoDate("2025-02-30"), false);
  assert.equal(isIsoDate("2025-13-01"), false);
  assert.equal(isIsoDate("01/02/2025"), false);
  assert.equal(isIsoDate(20250101), false);
});
