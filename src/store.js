"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

/**
 * In-memory contract storage with optional JSON-file persistence.
 * Reads return copies, so callers cannot change stored data by accident.
 */
class ContractStore {
  #items = new Map();
  #filePath;

  constructor({ filePath = null } = {}) {
    this.#filePath = filePath;
    if (filePath && fs.existsSync(filePath)) {
      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
      for (const contract of saved) this.#items.set(contract.id, contract);
    }
  }

  all() {
    return [...this.#items.values()].map((contract) => ({ ...contract }));
  }

  get(id) {
    const contract = this.#items.get(id);
    return contract ? { ...contract } : null;
  }

  create(data) {
    const timestamp = new Date().toISOString();
    const contract = { id: crypto.randomUUID(), ...data, createdAt: timestamp, updatedAt: timestamp };
    this.#items.set(contract.id, contract);
    this.#persist();
    return { ...contract };
  }

  replace(id, data) {
    const existing = this.#items.get(id);
    if (!existing) return null;
    const contract = {
      id,
      ...data,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.#items.set(id, contract);
    this.#persist();
    return { ...contract };
  }

  remove(id) {
    const removed = this.#items.delete(id);
    if (removed) this.#persist();
    return removed;
  }

  #persist() {
    if (!this.#filePath) return;
    // Write to a temporary file first so a crash cannot leave a half-written file.
    const temporary = `${this.#filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.all(), null, 2));
    fs.renameSync(temporary, this.#filePath);
  }
}

module.exports = { ContractStore };
