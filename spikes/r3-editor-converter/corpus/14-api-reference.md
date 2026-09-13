---
title: Documents API
sidebar_position: 4
---

# Documents API

Source: written for this spike, in the shape of a Fastify or Stripe API reference page.

## `GET /api/documents/:id`

Returns a single document by ID. Documents are addressed by ID, never by path.

### Parameters

| Name | In | Type | Required | Description |
| ---- | -- | ---- | :------: | ----------- |
| `id` | path | `string` | yes | The document ULID |
| `revision` | query | `string` | no | A commit SHA or `latest` |
| `format` | query | `"markdown" \| "ast"` | no | Defaults to `markdown` |

### Response

```json
{
  "id": "01J8Z0W5XK9Y3B6QN2D4V7H1TC",
  "title": "Runbook: incident response",
  "revision": "9f1c2ab",
  "body": "# Runbook\n\n..."
}
```

### Errors

| Status | Code | When |
| -----: | ---- | ---- |
| 404 | `document_not_found` | No document with that ID in this workspace |
| 403 | `forbidden` | The caller lacks `document:read` |
| 409 | `revision_conflict` | The document moved since `revision` |

## `PUT /api/documents/:id`

Replaces the body of a document. The request body is `text/markdown`.

> **Note**
> A `PUT` from the editor publishes the draft. Formatting-only differences are
> labelled in the diff view, per ADR-002.

### Example

```bash
curl -X PUT "https://quill.example.com/api/documents/01J8Z0W5XK9Y3B6QN2D4V7H1TC" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/markdown" \
  --data-binary @runbook.md
```

See also: [`GET /api/documents`](#get-apidocuments), [webhooks](./webhooks.md).
