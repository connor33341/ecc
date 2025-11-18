# ECC Worker - Cloudflare Workers Backend

This directory contains the Cloudflare Workers backend for the ECC Messenger application. It provides secure authentication via challenge-response signing and WebSocket-based real-time messaging.

## Features

- **Challenge-Response Authentication**: Users authenticate by signing a challenge with their Ethereum wallet
- **WebSocket Real-Time Communication**: Persistent connections for instant messaging
- **Durable Objects**: Manages chat rooms and maintains connection state
- **Direct & Broadcast Messaging**: Send encrypted messages to specific users or broadcast to all
- **Session Management**: Secure session handling with expiration

## Architecture

### Authentication Flow

1. Client requests a challenge from `/api/auth/challenge`
2. Client signs the challenge with their Ethereum wallet (MetaMask)
3. Client sends signature to `/api/auth/verify`
4. Backend verifies signature using ethers.js
5. Backend creates session and returns sessionId
6. Client uses sessionId for WebSocket connection

### WebSocket Protocol

**Connection**: `ws://your-worker.dev/ws?sessionId=<sessionId>`

**Message Types**:
- `chat_message` - Send/receive encrypted messages
- `online_users` - List of currently connected users
- `user_connected` - Notification when a user joins
- `user_disconnected` - Notification when a user leaves
- `ping`/`pong` - Keep-alive heartbeat

## Setup

### Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)
- Cloudflare account (free tier works)
- Wrangler CLI

### Installation

1. Install dependencies:
```bash
cd worker
pnpm install
```

2. Login to Cloudflare:
```bash
pnpm wrangler login
```

3. Update `wrangler.toml` with your configuration:
```toml
name = "ecc-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "CHAT_ROOM", class_name = "ChatRoom" }
]

[[migrations]]
tag = "v1"
new_classes = ["ChatRoom"]
```

### Development

Run locally with hot reload:
```bash
pnpm dev
```

The worker will be available at `http://localhost:8787`

### Deployment

Deploy to Cloudflare:
```bash
pnpm deploy
```

## API Endpoints

### Authentication

#### GET `/api/auth/challenge`
Get a challenge to sign for authentication.

**Response**:
```json
{
  "sessionId": "uuid-v4",
  "challenge": "Sign this message to authenticate with ECC:\n\nNonce: ...\nTimestamp: ..."
}
```

#### POST `/api/auth/verify`
Verify a signed challenge.

**Request**:
```json
{
  "sessionId": "uuid-v4",
  "signature": "0x..."
}
```

**Response**:
```json
{
  "success": true,
  "address": "0x...",
  "sessionId": "uuid-v4"
}
```

#### GET `/api/auth/session?sessionId=<id>`
Check if a session is valid.

**Response**:
```json
{
  "valid": true,
  "address": "0x..."
}
```

#### POST `/api/auth/logout`
Invalidate a session.

**Request**:
```json
{
  "sessionId": "uuid-v4"
}
```

### WebSocket

#### WS `/ws?sessionId=<id>`
Connect to the chat room with an authenticated session.

**Incoming Message Types**:
- `chat_message`: Encrypted message from another user
- `message_sent`: Confirmation of sent message
- `online_users`: Array of connected user addresses
- `user_connected`: New user joined
- `user_disconnected`: User left

**Outgoing Message Format**:
```json
{
  "type": "chat_message",
  "to": "0x..." or "",
  "content": "encrypted-content",
  "signature": ""
}
```

## File Structure

```
worker/
├── src/
│   ├── index.ts       # Main worker entry point
│   ├── auth.ts        # Authentication manager
│   ├── chatroom.ts    # Durable Object for WebSocket handling
│   └── types.ts       # TypeScript types
├── package.json
├── tsconfig.json
├── wrangler.toml
└── README.md
```

## Security Considerations

1. **Challenge Expiry**: Challenges expire after 5 minutes
2. **Session Expiry**: Sessions expire after 24 hours
3. **Message Encryption**: Messages are encrypted client-side before sending
4. **Signature Verification**: All authentication uses cryptographic signature verification
5. **CORS**: Configured for cross-origin requests (update in production)

## Environment Variables

For production, you may want to add:

```toml
[vars]
ALLOWED_ORIGINS = "https://yourdomain.com"
MAX_CONNECTIONS_PER_USER = "5"
```

## Monitoring

View logs in Cloudflare dashboard or via CLI:
```bash
pnpm wrangler tail
```

## Troubleshooting

### WebSocket Connection Issues
- Ensure sessionId is valid and not expired
- Check browser console for errors
- Verify worker is deployed and accessible

### Authentication Failures
- Verify MetaMask is installed and unlocked
- Check that signature format is correct
- Ensure challenge hasn't expired

## Production Checklist

- [ ] Update CORS origins in `index.ts`
- [ ] Set up custom domain in Cloudflare
- [ ] Update `WORKER_URL` in frontend components
- [ ] Enable rate limiting (Cloudflare Rules)
- [ ] Set up monitoring and alerts
- [ ] Review and adjust expiration times
- [ ] Add message size limits
- [ ] Implement message persistence (if needed)

## License

MIT
