# @deepseek-ai/dsh-client-ui-weixin-channel

English | [中文](README.zh.md)

Browser presentation for the Xiaojing Weixin channel. It adds a “Channels” settings section, keeps the Weixin card expanded by default, and presents pairing, verification, connection, reconnection, expiry, and error states without owning credentials or transport state.

## Composition and Presentation

The Client plugin registers `settings.section` with id `channels` and order `25` only for the `xiaojing` build profile on a loopback origin. Its observable controller calls the Host's `/xiaojing-weixin` RPC endpoints and refreshes status while the section is mounted. An in-flight user action suppresses periodic refreshes so a stale status response cannot overwrite pairing, verification, or disconnect feedback.

The page displays a Host-generated QR image with an expiry countdown, phone confirmation and numeric verification instructions, the masked connected account, online state, reconnect and disconnect controls, and explicit media-support and approval notices. It never parses the QR payload or receives the iLink token, message context token, CDN key, or file bytes.

## Security

The UI refuses to register on a non-loopback origin or outside the Xiaojing build profile. Every response type is browser-safe and contains only connection state, a masked account label, QR image data, expiry, verification requirement, and a user-safe error. Credential and durable queue operations remain Host-only.

## Model Experience

None, as this browser-only plugin renders sanitized Weixin connection state and registers nothing model-facing.

#### KV Cache effect

No direct effect; opening, pairing, refreshing, or disconnecting the settings view does not alter a model request.

## Known Limitations and Deferred Work

- The section manages one preinstalled Weixin channel and does not provide arbitrary channel or account plug-in management.
- Status refresh runs only while the settings component is mounted; the Host continues polling independently.
- V1 presents direct text, image, and document support. Audio, video, ordinary groups, OCR, and image understanding remain unavailable.
