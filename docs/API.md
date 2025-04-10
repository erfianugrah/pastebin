# Pastebin API Documentation

This document describes the API endpoints available for the Pastebin service.

## Base URL

The API is available at the same base URL as the web interface:

```
https://paste.erfianugrah.com/
```

For local development:

```
http://localhost:8787/
```

## Content Types

- All API requests should use `application/json` content type
- All API responses are returned as JSON
- Exception: Raw paste endpoint returns text/plain

## Authentication

- Currently, the API does not require authentication
- Rate limiting is applied to prevent abuse

## Endpoints

### Create a Paste

Create a new paste with specified content and options.

**Endpoint:** `POST /pastes`

**Request Body:**

```json
{
  "content": "string", // Required: The content of the paste
  "title": "string", // Optional: Title for the paste
  "language": "string", // Optional: Programming language for syntax highlighting
  "expiration": 86400, // Optional: Expiration time in seconds (default: 86400 - 1 day)
  "visibility": "public", // Optional: "public" or "private" (default: "public")
  "password": "string", // Optional: Password to protect the paste
  "burnAfterReading": false // Optional: Whether the paste self-destructs after viewing (default: false)
}
```

**Response:**

```json
{
  "id": "string", // Unique identifier for the paste
  "url": "string", // Full URL to access the paste
  "expiresAt": "string" // ISO timestamp when the paste will expire
}
```

**Status Codes:**
- `201 Created`: Paste successfully created
- `400 Bad Request`: Invalid request data
- `429 Too Many Requests`: Rate limit exceeded

**Example:**

```bash
curl -X POST https://paste.erfianugrah.com/pastes \
  -H "Content-Type: application/json" \
  -d '{
    "content": "console.log(\"Hello, World!\");",
    "title": "Hello World",
    "language": "javascript",
    "expiration": 3600,
    "visibility": "public"
  }'
```

### Get a Paste

Retrieve a paste by its ID.

**Endpoint:** `GET /pastes/:id`

**Headers:**
- `Accept: application/json` (Required for JSON response)

**Response:**

```json
{
  "id": "string",
  "content": "string",
  "title": "string",
  "language": "string",
  "createdAt": "string",
  "expiresAt": "string",
  "visibility": "public",
  "isPasswordProtected": false,
  "burnAfterReading": false
}
```

**Status Codes:**
- `200 OK`: Paste found and returned
- `403 Forbidden`: Paste requires a password
- `404 Not Found`: Paste not found or expired

**Example:**

```bash
curl -X GET https://paste.erfianugrah.com/pastes/abc123 \
  -H "Accept: application/json"
```

### Access a Password-Protected Paste

Access a paste that is protected by a password.

**Endpoint:** `POST /pastes/:id`

**Request Body:**

```json
{
  "password": "string" // Required: The password for the paste
}
```

**Response:**
- Same as "Get a Paste" endpoint

**Status Codes:**
- `200 OK`: Password correct, paste returned
- `403 Forbidden`: Incorrect password
- `404 Not Found`: Paste not found or expired

**Example:**

```bash
curl -X POST https://paste.erfianugrah.com/pastes/abc123 \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"password": "secretpassword"}'
```

### Get Raw Paste Content

Retrieve the raw content of a paste without formatting or metadata.

**Endpoint:** `GET /pastes/raw/:id`

**Response:**
- Plain text content of the paste

**Status Codes:**
- `200 OK`: Paste found and returned
- `403 Forbidden`: Paste requires a password
- `404 Not Found`: Paste not found or expired

**Example:**

```bash
curl -X GET https://paste.erfianugrah.com/pastes/raw/abc123
```

## Error Responses

All error responses follow this format:

```json
{
  "error": {
    "code": "string", // Error code
    "message": "string", // Human-readable message
    "details": {} // Optional additional details
  }
}
```

**Common Error Codes:**
- `validation_error`: Request data didn't pass validation
- `not_found`: Requested resource doesn't exist
- `paste_not_found`: Paste not found or expired
- `invalid_password`: Incorrect password for protected paste
- `rate_limit_exceeded`: Too many requests from this client
- `internal_server_error`: Unexpected server error

## Rate Limiting

Rate limiting is applied to protect the service:

- General rate limit: 60 requests per minute
- Paste creation: 10 pastes per minute

When rate limited, you'll receive a `429 Too Many Requests` response with:

```json
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Too many requests, please try again later",
    "details": {
      "retryAfter": 10,
      "limit": 60,
      "remaining": 0
    }
  }
}
```

The `Retry-After` header will be set with the number of seconds to wait.

## HTTP Caching

The API uses HTTP caching headers to improve performance:

- Successful paste retrievals: Cached for 1 hour
- Static assets: Cached for 1 day with stale-while-revalidate for 1 week
- POST responses and error responses: Not cached