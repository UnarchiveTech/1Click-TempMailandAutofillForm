# Custom Burner Instance API Documentation

This document describes the API endpoints and requirements for custom Burner.kiwi-compatible instances that can be used with the 1Click: Temp Mail extension.

## Overview

The extension supports custom Burner.kiwi-compatible email service instances. These instances must implement a specific API interface to work with the extension's email fetching and inbox management features.

## BurnerInstance Configuration

Each custom Burner instance requires the following configuration:

```typescript
interface BurnerInstance {
  id: string;           // Unique identifier for the instance
  name: string;         // Internal name (e.g., 'my-custom-instance')
  displayName: string;  // User-facing display name (e.g., 'My Custom Mail')
  apiUrl: string;       // Base URL for the API (e.g., 'https://api.example.com/api/v2')
  isCustom?: boolean;   // Set to true for custom instances (auto-generated)
}
```

## Required API Endpoints

### 1. Create Inbox

**Endpoint:** `GET {apiUrl}/inbox`

**Description:** Creates a new inbox and returns the email address, inbox ID, and authentication token.

**Response Format:**
```json
{
  "success": true,
  "errors": null,
  "result": {
    "email": {
      "address": "string",
      "id": "string",
      "created_at": number,
      "ttl": number
    },
    "token": "string"
  }
}
```

### 2. Get Inbox Details

**Endpoint:** `GET {apiUrl}/inbox/{inboxId}`

**Headers:**
```
X-Burner-Key: {token}
```

**Description:** Retrieves details for a specific inbox.

**Request Parameters:**
- `inboxId` - The unique identifier of the inbox
- `token` - The bearer token for the inbox (passed in header)

**Response Format:**
```json
{
  "success": true,
  "errors": null,
  "result": {
    "address": "string",
    "id": "string",
    "created_at": number,
    "ttl": number
  }
}
```

### 3. Fetch Messages

**Endpoint:** `GET {apiUrl}/inbox/{inboxId}/messages`

**Headers:**
```
X-Burner-Key: {token}
```

**Description:** Retrieves all messages for a specific inbox.

**Request Parameters:**
- `inboxId` - The unique identifier of the inbox
- `token` - The bearer token for the inbox (passed in header)

**Response Format:**
```json
{
  "success": true,
  "errors": null,
  "result": [
    {
      "id": "string",
      "received_at": number,
      "sender": "string",
      "from_name": "string",
      "from_address": "string",
      "subject": "string",
      "body_html": "string",
      "body_plain": "string",
      "ttl": number
    }
  ]
}
```

**Error Response:**
```json
{
  "success": false,
  "errors": {
    "msg": "Error message description"
  }
}
```

## Predefined Instances

The extension includes the following predefined Burner instances:

| ID | Name | Display Name | API URL |
|----|------|--------------|---------|
| `alphac` | alphac | Alphac Mail | https://alphac.qzz.io/api/v2 |
| `raceco` | raceco | Raceco Mail | https://raceco.dpdns.org/api/v2 |
| `burnerkiwi` | burner.kiwi | Burner.Kiwi | https://burner.kiwi/api/v2 |

## Adding Custom Instances

### Via Extension Settings

1. Open the extension settings
2. Navigate to the Burner.kiwi instance section
3. Click "Add Custom Instance"
4. Provide:
   - Display name (e.g., "My Custom Mail")
   - API URL (e.g., "https://api.example.com/api/v2")
5. Save the configuration

### Via Storage API

Custom instances can also be added programmatically:

```javascript
await browser.storage.local.set({
  customBurnerInstances: [
    {
      id: 'custom_1234567890',
      name: 'my-instance',
      displayName: 'My Custom Mail',
      apiUrl: 'https://api.example.com/api/v2',
      isCustom: true
    }
  ]
});
```

## API Implementation Requirements

To create a compatible custom Burner instance, your API must:

1. **Implement the messages endpoint** with the exact response format shown above
2. **Support bearer token authentication** via the `X-Burner-Key` header
3. **Return timestamps** as Unix epoch seconds (`received_at`)
4. **Include both HTML and plain text** body variants (`body_html`, `body_plain`)
5. **Handle inbox IDs** as opaque strings passed from the extension

## Example API Implementation

Here's a simple example of a compatible API endpoint:

```typescript
// Example Express.js endpoint
app.get('/api/v2/inbox/:inboxId/messages', async (req, res) => {
  const { inboxId } = req.params;
  const token = req.headers['x-burner-key'];

  // Validate token
  const inbox = await validateInboxToken(inboxId, token);
  if (!inbox) {
    return res.status(401).json({
      success: false,
      errors: { msg: 'Invalid or expired token' }
    });
  }

  // Fetch messages
  const messages = await getMessagesForInbox(inboxId);

  return res.json({
    success: true,
    errors: null,
    result: messages.map(msg => ({
      id: msg.id,
      received_at: Math.floor(msg.createdAt.getTime() / 1000),
      sender: msg.fromAddress,
      from_name: msg.fromName,
      from_address: msg.fromAddress,
      subject: msg.subject,
      body_html: msg.bodyHtml,
      body_plain: msg.bodyPlain,
      ttl: msg.ttl
    }))
  });
});
```

## Testing Your Custom Instance

1. Add your custom instance via settings
2. Select it as the active Burner instance
3. Create a new inbox
4. Send a test email to the generated address
5. Refresh the inbox to verify message fetching

## Troubleshooting

### Common Issues

**"Failed to fetch messages" error:**
- Verify the API URL is correct and accessible
- Check that the `X-Burner-Key` header is being accepted
- Ensure the response format matches the expected structure

**Messages not appearing:**
- Check that `received_at` timestamps are in seconds (not milliseconds)
- Verify the `success` field is set to `true` in responses
- Ensure CORS is properly configured if the API is on a different domain

**Token authentication failures:**
- Confirm that tokens are being generated and stored correctly
- Verify the token validation logic matches the extension's expectations
- Check that tokens haven't expired

## Security Considerations

- Custom instances should use HTTPS in production
- Implement proper token validation and expiration
- Rate limit API calls to prevent abuse
- Validate all input parameters to prevent injection attacks
- Consider implementing additional authentication mechanisms if needed

## Support

For issues with custom Burner instances, check:
1. Browser console for error messages
2. Network tab for failed API requests
3. Extension background script logs
4. API server logs for request/response details
