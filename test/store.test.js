"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ContractStore } = require("../src/store");
const { validateContract } = require("../src/validate");
const { sample } = require("./helpers");

const data = validateContract(sample).data;

test("returns copies, so callers cannot mutate stored data", () => {
  const store = new ContractStore();
  const created = store.create(data);
  created.title = "Changed";
  assert.equal(store.get(created.id).title, sample.title);
});

test("replace keeps id and createdAt", () => {
  const store = new ContractStore();
  const created = store.create(data);
  const replaced = store.replace(created.id, { ...data, title: "New title" });
  assert.equal(replaced.id, created.id);
  assert.equal(replaced.createdAt, created.createdAt);
  assert.equal(replaced.title, "New title");
  assert.equal(store.replace("missing", data), null);
});

test("persists to disk and reloads", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contracts-"));
  const filePath = path.join(dir, "contracts.json");
  try {
    const first = new ContractStore({ filePath });
    const created = first.create(data);
    const second = new ContractStore({ filePath });
    assert.equal(second.get(created.id).title, sample.title);
    second.remove(created.id);
    assert.equal(new ContractStore({ filePath }).all().length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
