"use strict";

const STATUSES = ["draft", "active", "expired", "terminated"];

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  // The round trip rejects impossible dates such as 2025-02-30.
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function checkText(input, field, min, max, add) {
  const value = input[field];
  if (typeof value !== "string") {
    add(field, "is required and must be a string");
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    add(field, `must be between ${min} and ${max} characters`);
    return undefined;
  }
  return trimmed;
}

/**
 * Validate a full contract payload.
 * Returns { errors, data }: `errors` is a list of { field, message };
 * `data` holds the cleaned fields (unknown fields are dropped) and is only
 * meaningful when `errors` is empty.
 */
function validateContract(input) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  const data = {};

  data.title = checkText(input, "title", 3, 120, add);
  data.supplier = checkText(input, "supplier", 2, 80, add);

  if (typeof input.value !== "number" || !Number.isFinite(input.value) || input.value < 0) {
    add("value", "is required and must be a non-negative number");
  } else {
    data.value = Math.round(input.value * 100) / 100;
  }

  const currency = input.currency === undefined ? "EUR" : input.currency;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    add("currency", "must be a three-letter uppercase ISO code, for example EUR");
  } else {
    data.currency = currency;
  }

  const status = input.status === undefined ? "draft" : input.status;
  if (!STATUSES.includes(status)) {
    add("status", `must be one of: ${STATUSES.join(", ")}`);
  } else {
    data.status = status;
  }

  for (const field of ["startDate", "endDate"]) {
    if (!isIsoDate(input[field])) {
      add(field, "is required and must be a valid date in YYYY-MM-DD format");
    } else {
      data[field] = input[field];
    }
  }
  if (data.startDate && data.endDate && data.endDate < data.startDate) {
    add("endDate", "must not be before startDate");
  }

  return { errors, data };
}

module.exports = { STATUSES, isIsoDate, validateContract };
