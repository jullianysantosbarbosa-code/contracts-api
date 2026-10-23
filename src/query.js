"use strict";

const { STATUSES } = require("./validate");

const SORT_FIELDS = ["title", "supplier", "value", "startDate", "endDate", "createdAt"];
const DAY_MS = 24 * 60 * 60 * 1000;

function readNumber(params, name, errors, { integer = false, min = -Infinity, max = Infinity } = {}) {
  const raw = params.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  const valid = raw.trim() !== "" && Number.isFinite(value) && (!integer || Number.isInteger(value));
  if (!valid || value < min || value > max) {
    errors.push({ field: name, message: `must be ${integer ? "an integer" : "a number"} between ${min} and ${max}` });
    return undefined;
  }
  return value;
}

/** Turn URL query parameters into validated list options. */
function parseListQuery(params) {
  const errors = [];
  const options = { page: 1, limit: 20, sortField: "createdAt", sortDirection: "desc" };

  const status = params.get("status");
  if (status !== null) {
    if (STATUSES.includes(status)) options.status = status;
    else errors.push({ field: "status", message: `must be one of: ${STATUSES.join(", ")}` });
  }

  const supplier = params.get("supplier");
  if (supplier && supplier.trim()) options.supplier = supplier.trim().toLowerCase();

  const minValue = readNumber(params, "minValue", errors, { min: 0 });
  const maxValue = readNumber(params, "maxValue", errors, { min: 0 });
  if (minValue !== undefined) options.minValue = minValue;
  if (maxValue !== undefined) options.maxValue = maxValue;

  const sort = params.get("sort");
  if (sort !== null) {
    const [field, direction = "asc"] = sort.split(":");
    if (SORT_FIELDS.includes(field) && ["asc", "desc"].includes(direction)) {
      options.sortField = field;
      options.sortDirection = direction;
    } else {
      errors.push({ field: "sort", message: `must look like field[:asc|desc] with field one of: ${SORT_FIELDS.join(", ")}` });
    }
  }

  const page = readNumber(params, "page", errors, { integer: true, min: 1 });
  const limit = readNumber(params, "limit", errors, { integer: true, min: 1, max: 100 });
  if (page !== undefined) options.page = page;
  if (limit !== undefined) options.limit = limit;

  return { errors, options };
}

/** Filter, sort and paginate contracts. */
function queryContracts(contracts, options) {
  const { status, supplier, minValue, maxValue, sortField, sortDirection, page, limit } = options;

  const filtered = contracts.filter(
    (c) =>
      (status === undefined || c.status === status) &&
      (supplier === undefined || c.supplier.toLowerCase().includes(supplier)) &&
      (minValue === undefined || c.value >= minValue) &&
      (maxValue === undefined || c.value <= maxValue)
  );

  const factor = sortDirection === "desc" ? -1 : 1;
  filtered.sort((a, b) => {
    const left = a[sortField];
    const right = b[sortField];
    const order = typeof left === "number" ? left - right : String(left).localeCompare(String(right));
    return order * factor;
  });

  const start = (page - 1) * limit;
  return {
    data: filtered.slice(start, start + limit),
    meta: { total: filtered.length, page, limit, pages: Math.max(1, Math.ceil(filtered.length / limit)) },
  };
}

/** Active contracts that end between `today` and `today + days`, soonest first. */
function expiringContracts(contracts, today, days) {
  const lastDay = new Date(new Date(`${today}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return contracts
    .filter((c) => c.status === "active" && c.endDate >= today && c.endDate <= lastDay)
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
    .map((c) => ({
      ...c,
      daysRemaining: Math.round((new Date(`${c.endDate}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / DAY_MS),
    }));
}

/** Contract counts per status and the total value of active contracts per currency. */
function contractStats(contracts) {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const activeValueByCurrency = {};
  for (const c of contracts) {
    byStatus[c.status] += 1;
    if (c.status === "active") {
      activeValueByCurrency[c.currency] = (activeValueByCurrency[c.currency] || 0) + c.value;
    }
  }
  for (const currency of Object.keys(activeValueByCurrency)) {
    activeValueByCurrency[currency] = Math.round(activeValueByCurrency[currency] * 100) / 100;
  }
  return { total: contracts.length, byStatus, activeValueByCurrency };
}

module.exports = { parseListQuery, queryContracts, expiringContracts, contractStats };
