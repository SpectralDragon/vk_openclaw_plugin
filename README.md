# vk-openclaw-plugin

VK Callback API plugin for OpenClaw.

## Features
- VK Callback API webhook handling
- Inbound/outbound messaging
- Attachment parsing (photos/docs/voice/stickers)
- Allow list controls
- Callback secret authorization
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
VK_CONFIRMATION_TOKEN=...      # Confirmation token from VK Callback API settings

# Optional
VK_CALLBACK_SECRET=...         # Secret key from VK Callback API settings
VK_CALLBACK_PATH=/vk/callback  # Default: /vk/callback
VK_ALLOWLIST_USER_IDS=1,2,3    # Only these user IDs can trigger the agent
VK_ALLOWLIST_CHAT_IDS=10,20    # Only these chat IDs (peer_id-2000000000)
```

## VK Callback API setup
1. Create a VK group and bot token.
2. In **Callback API** settings:
   - Set **Server URL** to `https://<your-domain>/vk/callback`
   - Set **Secret key** (optional) and put it into `VK_CALLBACK_SECRET`
   - Copy **Confirmation token** into `VK_CONFIRMATION_TOKEN`
3. Enable event: **message_new**

## Notes
- For group chats, VK uses `peer_id = 2000000000 + chat_id`.
- Allow lists are optional. If empty, all users/chats are allowed.
- Attachments are forwarded as media URLs where possible.

## Local dev
```bash
npm install
npm run build
```
