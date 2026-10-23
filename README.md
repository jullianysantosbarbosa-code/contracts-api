# Contracts API

[![CI](https://github.com/jullianysantosbarbosa-code/contracts-api/actions/workflows/ci.yml/badge.svg)](https://github.com/jullianysantosbarbosa-code/contracts-api/actions/workflows/ci.yml)
![Node 20+](https://img.shields.io/badge/node-20%2B-339933)
![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

A REST API for managing supplier contracts, written in Node.js with **no third-party dependencies**: just the built-in `http`, `fs`, `crypto` and `node:test` modules.

During my years in public procurement, the questions that mattered most about a contract were simple: who is the supplier, how much is it worth, is it still active, and when does it end? This API models exactly that, with careful input validation, filtering, sorting, pagination and an "expiring soon" report. All sample data is fictional.

## Features

- Full **CRUD** for contracts (`POST`, `GET`, `PUT`, `PATCH`, `DELETE`) with correct status codes (`201` with a `Location` header, `204`, `404`, `405` with `Allow`, `413`).
- **Validation that reports every problem at once**, with the field name and a readable message.
- **Filtering, sorting and pagination** on the list endpoint, all validated.
- **Expiring contracts report**: active contracts that end within the next N days.
- **Statistics**: contracts per status and total active value per currency.
- **Optional persistence** to a JSON file, written atomically (temp file, then rename).
- **Consistent JSON errors**: every failure has an `error` code and a `message`.
- **29 automated tests** that start a real server on a random port and call it over HTTP.

## Quick start

```bash
git clone https://github.com/jullianysantosbarbosa-code/contracts-api.git
cd contracts-api
npm start
```

Requires Node.js 20 or later. There is nothing to install. The server listens on port 3000 by default.

| Variable    | Default | Purpose                                              |
| ----------- | ------- | ---------------------------------------------------- |
| `PORT`      | `3000`  | Port to listen on                                    |
| `DATA_FILE` | none    | Path of a JSON file used to keep data between restarts |

```bash
PORT=8080 DATA_FILE=./data/contracts.json npm start
```

Without `DATA_FILE`, data is kept in memory and lost on restart.

## Endpoints

| Method   | Path                  | Description                                  |
| -------- | --------------------- | -------------------------------------------- |
| `GET`    | `/health`             | Liveness check                               |
| `GET`    | `/stats`              | Counts per status, active value per currency |
| `GET`    | `/contracts`          | List with filters, sorting and pagination    |
| `GET`    | `/contracts/expiring` | Active contracts ending within `days` days   |
| `POST`   | `/contracts`          | Create a contract                            |
| `GET`    | `/contracts/:id`      | Get one contract                             |
| `PUT`    | `/contracts/:id`      | Replace a contract                           |
| `PATCH`  | `/contracts/:id`      | Change some fields                           |
| `DELETE` | `/contracts/:id`      | Delete a contract                            |

### The contract resource

| Field       | Type   | Rules                                                      |
| ----------- | ------ | ---------------------------------------------------------- |
| `title`     | string | Required, 3 to 120 characters                              |
| `supplier`  | string | Required, 2 to 80 characters                               |
| `value`     | number | Required, zero or more                                     |
| `currency`  | string | Optional, three uppercase letters, default `EUR`           |
| `status`    | string | Optional, `draft` (default), `active`, `expired`, `terminated` |
| `startDate` | string | Required, a real date in `YYYY-MM-DD` format               |
| `endDate`   | string | Required, a real date, not before `startDate`              |

`id`, `createdAt` and `updatedAt` are set by the server. Unknown fields are ignored.

### List query parameters

| Parameter            | Example               | Notes                                        |
| -------------------- | --------------------- | -------------------------------------------- |
| `status`             | `status=active`       | One of the four statuses                     |
| `supplier`           | `supplier=atlas`      | Case-insensitive partial match               |
| `minValue`, `maxValue` | `minValue=5000`     | Inclusive range                              |
| `sort`               | `sort=value:desc`     | `title`, `supplier`, `value`, `startDate`, `endDate`, `createdAt`; default `createdAt:desc` |
| `page`, `limit`      | `page=2&limit=10`     | Defaults 1 and 20, maximum limit 100         |

## Examples

Create a contract:

```bash
curl -i -X POST http://localhost:3000/contracts \
  -H 'Content-Type: application/json' \
  -d '{"title":"Cloud hosting 2026","supplier":"Atlas Cloud Services","value":48000,"status":"active","startDate":"2026-01-01","endDate":"2026-11-15"}'
```

```text
HTTP/1.1 201 Created
Location: /contracts/e061b363-ce68-4222-8d4e-b46d4d01e63a

{"id":"e061b363-ce68-4222-8d4e-b46d4d01e63a","title":"Cloud hosting 2026","supplier":"Atlas Cloud Services",
 "value":48000,"currency":"EUR","status":"active","startDate":"2026-01-01","endDate":"2026-11-15",
 "createdAt":"2026-10-17T20:51:08.564Z","updatedAt":"2026-10-17T20:51:08.564Z"}
```

Send invalid data and get every problem back at once:

```bash
curl -X POST http://localhost:3000/contracts \
  -H 'Content-Type: application/json' \
  -d '{"title":"x","value":-5,"startDate":"2026-03-01","endDate":"2026-01-01"}'
```

```json
{
  "error": "ValidationError",
  "message": "The contract is invalid",
  "details": [
    { "field": "title", "message": "must be between 3 and 120 characters" },
    { "field": "supplier", "message": "is required and must be a string" },
    { "field": "value", "message": "is required and must be a non-negative number" },
    { "field": "endDate", "message": "must not be before startDate" }
  ]
}
```

List the most valuable active contract:

```bash
curl 'http://localhost:3000/contracts?status=active&sort=value:desc&limit=1'
```

```text
{"data":[{"id":"e061b363-...","title":"Cloud hosting 2026","value":48000, ...}],
 "meta":{"total":2,"page":1,"limit":1,"pages":2}}
```

Contracts that need attention in the next 60 days:

```bash
curl 'http://localhost:3000/contracts/expiring?days=60'
```

```text
{"data":[{"id":"e061b363-...","title":"Cloud hosting 2026","endDate":"2026-11-15","daysRemaining":29, ...}],
 "meta":{"today":"2026-10-17","days":60,"total":1}}
```

Summary statistics:

```bash
curl http://localhost:3000/stats
```

```json
{ "total": 2, "byStatus": { "draft": 0, "active": 2, "expired": 0, "terminated": 0 }, "activeValueByCurrency": { "EUR": 57000 } }
```

## Error format

Every error response has the same shape, and validation errors add a `details` list:

| Status | `error`                | When                                         |
| ------ | ---------------------- | -------------------------------------------- |
| 400    | `ValidationError`      | The contract fails validation                |
| 400    | `InvalidQuery`         | A query parameter is invalid                 |
| 400    | `InvalidJson`, `InvalidBody` | The body is empty, malformed, or not a JSON object |
| 404    | `NotFound`             | Unknown route or contract id                 |
| 405    | `MethodNotAllowed`     | Wrong method for the path (an `Allow` header is sent) |
| 413    | `PayloadTooLarge`      | The body is larger than 1 MB                 |
| 500    | `InternalServerError`  | Unexpected failure (details are logged, not exposed) |

## Project structure

```text
contracts-api/
├── src/
│   ├── index.js     # entry point: configuration and graceful shutdown
│   ├── app.js       # HTTP server, router, error handling
│   ├── validate.js  # contract validation rules
│   ├── query.js     # filtering, sorting, pagination, reports
│   └── store.js     # in-memory storage with optional JSON persistence
├── test/            # 29 tests (node:test)
└── .github/workflows/ci.yml
```

## Testing

```bash
npm test
```

Tests run with Node's built-in test runner. The API tests start a real server on a random port and use `fetch`, so they exercise the full request path, not just the functions. Date-dependent behaviour (the expiring report) uses an injected clock so the results never change. GitHub Actions runs the suite on Node 20 and 22 for every push.

## Design decisions

- **No framework.** Building the router, body parsing and error handling by hand shows what Express would otherwise hide. The code is small enough to read in one sitting.
- **Validation is separate from HTTP.** `validateContract` is a pure function, so it is tested on its own and reused for `POST`, `PUT` and `PATCH`.
- **`PATCH` merges, then validates the whole contract.** Cross-field rules, such as "end date not before start date", cannot be bypassed with a partial update.
- **Copies, not references.** The store never hands out its internal objects, so a bug in a handler cannot silently corrupt stored data.
- **Injectable clock and logger.** `createApp(store, { now, logger })` keeps time-dependent logic deterministic in tests.

## Roadmap

- Authentication (API keys or JWT) and per-user data.
- A database backend (SQLite or PostgreSQL) behind the same store interface.
- OpenAPI specification and generated documentation.
- Rate limiting and CORS configuration.

## Author

Julliany Barbosa · [LinkedIn](https://www.linkedin.com/in/julliany-santos-barbosa) · [GitHub](https://github.com/jullianysantosbarbosa-code)

Released under the [MIT License](LICENSE).
