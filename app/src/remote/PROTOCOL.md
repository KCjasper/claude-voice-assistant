# Mobile remote protocol v1

The desktop serves static client assets over HTTP and accepts authenticated
WebSocket connections at `/ws`.

## Authentication

1. The desktop exposes an in-memory pairing URL through local Electron IPC and
   renders it as a QR code. The token is placed in the URL fragment:
   `http://<lan-ip>:<port>/#token=<pairing-token>`.
2. The fragment is not sent in the HTTP request. The mobile client reads it,
   removes it from the visible URL, then connects to
   `/ws?token=<pairing-token>`.
3. The token is consumed once. `auth.ready` returns a session token.
4. Reconnect with `/ws?session=<session-token>`.
5. Rotating the pairing token or stopping the server revokes all sessions.

Tokens are never persisted. WebSocket upgrades without a valid token receive
HTTP 401. Browser origins must match the request host. Direct HTTP and
WebSocket traffic is accepted only from private, link-local, or loopback
addresses. A local Cloudflare process may proxy public traffic through
loopback; forwarded hosts are trusted only when the socket peer is loopback.

See `TUNNEL.md` for the public tunnel lifecycle and security boundary.

## Client messages

Every message is JSON and requires a unique string `requestId`.

- `ping`
- `session.get`
- `chat.send`: `{ text, options? }`
- `stt.transcribe`: `{ audioBase64, options? }` where audio is WAV, max 8 MB
- `tts.synthesize`: `{ text, options? }`
- `request.cancel`: `{ targetRequestId }`
- `interrupt`

## Server messages

- `auth.ready`: protocol and optional newly issued session token
- `progress`: streaming AI or STT progress for a request
- `result`: final structured backend result
- `session.state`: authoritative desktop session snapshot
- `pong`
- `error`: protocol-level validation failure

At most two operations may run concurrently per connection. Disconnecting
cancels tracked backend AI/STT/TTS tasks. The desktop remains the owner of API
keys, workspace access, Whisper, model routing, spending policy, and sessions.
