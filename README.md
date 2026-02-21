# vk-openclaw-plugin

VK Long Polling API plugin for OpenClaw.

## Features
- VK Long Polling inbound updates
- Inbound/outbound messaging
- Attachment parsing (photos/docs/voice/stickers)
- Allow list controls
- Extra events: message_edit, message_reply, message_allow, message_deny

## Install
```bash
npm i vk-openclaw-plugin
```

## Env configuration
```bash
# Required
VK_ACCESS_TOKEN=...            # VK group access token
VK_GROUP_ID=123456

# Optional
VK_API_VERSION=5.199           # VK API version for Long Poll requests
VK_LONGPOLL_WAIT=25            # 1..25 seconds, default 25
VK_ALLOWLIST_USER_IDS=1,2,3    # Only these user IDs can trigger the agent
VK_ALLOWLIST_CHAT_IDS=10,20    # Only these chat IDs (peer_id-2000000000)
```

## VK setup (Long Polling)
1. Create a VK group and group access token.
2. Ensure bot events are enabled for the group (at least `message_new`).
3. Start OpenClaw with this plugin; polling starts automatically on plugin registration.

## Notes
- This plugin no longer uses VK Callback API webhooks.
- `/vk/health` endpoint is available for basic plugin health check.
- `/vk/callback` responds with `410 Gone` to prevent accidental Callback API usage.
- For group chats, VK uses `peer_id = 2000000000 + chat_id`.
- Allow lists are optional. If empty, all users/chats are allowed.
- Attachments are forwarded as media URLs where possible.

## Local dev
```bash
npm install
npm run build
```
