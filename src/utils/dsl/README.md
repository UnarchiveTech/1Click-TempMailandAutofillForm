# DSL (JSON-driven email fetching)

The JSON-driven EmailService engine lives in this directory as a single
module, **email-fetcher.ts**. Older revisions of this document described a
planned multi-file split (`template-resolver.ts`, `path-extractor.ts`,
`request-builder.ts`, `response-parser.ts`) that was never shipped - those
files do not exist, and all import paths in this document point at
`@/utils/dsl/email-fetcher.js`.

## Responsibilities

- **Template resolution** - template variables (`{auth.token}`, `{timestamp}`,
  `{random}`, `{instanceUrl}`, custom `context.variables`) are resolved inline
  by `resolveTemplateValue`/`resolveTemplateParams`.
- **Request building** - `buildRequest` composes URL, auth, query params,
  headers, body, and cache options from the operation config.
- **Response parsing** - dot-notation extraction (`extractPath`) and success/
  data/field mapping (`parseResponse`, `checkForErrors`) run on the response.
- **Email orchestration** - `fetchEmails` ties the above together with
  multi-step detail fetching, pagination, and optional raw-source retrieval.

## Template Variables

Supported template variables in parameter values:

- `{auth.token}` - Authentication token from context
- `{timestamp}` - Current Unix timestamp
- `{random}` - Random string (**8** characters, from `randomToken(8)`)
- `{instanceUrl}` - Dynamic instance URL for multi-instance providers
- `{variableName}` - Custom variable from context.variables

### Example

```json
{
  "requiredParams": {
    "sid_token": "{auth.token}",
    "_t": "{timestamp}",
    "_r": "{random}"
  }
}
```

## Path Extraction

Response fields use dot notation for nested path extraction:

- `field` - Top-level field
- `result.email` - Nested field
- `result.email.address` - Deeply nested field

### Special Paths

- `!error` - Negation check (returns true if error is falsy)
- `` (empty string) - Returns the entire object

### Example

```json
{
  "response": {
    "successPath": "!error",
    "dataPath": "result",
    "fields": {
      "address": "email.address",
      "id": "email.id",
      "token": "token"
    }
  }
}
```

## API Styles

### Query Parameter Based (e.g., Guerrilla Mail)

Uses `f` query parameter to specify function:

```json
{
  "function": "get_email_address"
}
```

Generates: `https://api.example.com/ajax.php?f=get_email_address&ip=127.0.0.1`

### RESTful Path Based (e.g., Burner.kiwi)

Uses URL path to specify function:

```json
{
  "function": "/inbox/{inboxId}/messages"
}
```

Generates: `https://api.example.com/inbox/abc123/messages`

The EmailService automatically detects the style based on whether the function field starts with `/`.

## Authentication Types

### Query Parameter Authentication

```json
{
  "auth": {
    "type": "query_parameter",
    "paramName": "sid_token"
  }
}
```

Adds token as query parameter: `?sid_token=abc123`

### Header Authentication

```json
{
  "auth": {
    "type": "header",
    "paramName": "X-Burner-Key"
  }
}
```

Adds token as header: `X-Burner-Key: abc123`

## Multi-Instance Providers

Configuration for providers with multiple instances:

```json
{
  "apiUrl": "{instanceUrl}",
  "multiInstance": {
    "enabled": true,
    "randomSelectionDefault": true
  }
}
```

The instance URL is passed via `context.instanceUrl` when calling the service.

## Force New Session

Configuration for cache-busting and forcing new sessions:

```json
{
  "forceNewSession": {
    "enabled": true,
    "params": {
      "_t": "{timestamp}",
      "_r": "{random}",
      "_fresh": "1"
    },
    "headers": {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "X-Requested-With": "XMLHttpRequest"
    },
    "credentials": "omit",
    "cache": "no-cache"
  }
}
```

## Raw Source Retrieval (optional)

Some providers serve a server-filtered `mail_body` (stripped `<style>`/`@media`,
rewritten image URLs) but expose the untouched raw MIME source via a separate
operation. Configure `emailFetching.rawSource` to fetch it per message and store
it on `Email.raw_source` - rendering then prefers the original HTML part and
`.eml` export emits the raw source verbatim.

```json
{
  "emailFetching": {
    "type": "multi_step",
    "detailOperation": "fetchEmail",
    "detailItemIdParam": "email_id",
    "rawSource": {
      "operation": "getEmailSource",
      "itemIdParam": "email_id",
      "sourcePath": "source"
    }
  }
}
```

- `operation` - name of the `operations` entry that returns the raw source
- `itemIdParam` - context variable carrying the message id (same template
  variable used by the detail fetch, e.g. `{email_id}`)
- `sourcePath` - dot-notation path of the raw source string in the response

The raw-source call is best-effort: on failure the message still stores with the
provider's filtered `body_html`. Nothing in the DSL is provider-specific - all
values come from `providers.jsonc`.

## Error Handling

Configuration for error detection:

```json
{
  "errorHandling": {
    "errorPath": "error",
    "errorMessagePath": "error.message"
  }
}
```

## Usage

Everything is exported from the single module:

```typescript
import {
  buildRequest,
  fetchEmails,
  resolveTemplateValue,
} from '@/utils/dsl/email-fetcher.js';
```

All configuration comes from `providers.jsonc`; nothing here is
provider-specific.
