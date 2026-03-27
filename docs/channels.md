# Chat Channels

This document explains how to connect Telegram, Discord, and WhatsApp as inbound bot channels so that messages sent to those platforms are routed to Krythor agents.

---

## How Chat Channels Work

Inbound chat channels turn Krythor into a bot that can receive and respond to messages on external messaging platforms. When a user sends a message to your Telegram bot, Discord bot, or WhatsApp number, the message is delivered to the Krythor gateway, dispatched to the configured agent, and the agent's response is sent back to the user on the same platform.

The flow is:

```
User sends message on platform
        ↓
Platform delivers message to Krythor (via webhook or polling)
        ↓
Gateway dispatches to the assigned agent
        ↓
Agent processes the message using its configured model and tools
        ↓
Gateway sends agent response back to the platform
        ↓
User receives reply
```

Credentials are stored encrypted in the Krythor configuration. They are never exposed in API responses — secrets are masked with asterisks when returned by the `/api/chat-channels/` endpoints.

---

## Channel Status Reference

Each channel reports one of the following statuses:

| Status | Meaning |
|--------|---------|
| `not_installed` | The required package for this channel has not been installed yet |
| `installed` | Package is installed but no credentials have been entered |
| `credentials_missing` | Channel is configured but required credential fields are empty or incomplete |
| `awaiting_pairing` | Credentials have been submitted and the channel is waiting for a pairing step to complete (WhatsApp only) |
| `connected` | Channel is active and receiving messages |
| `error` | Channel encountered a runtime error; see the Logs panel for details |

---

## Adding a Channel

1. Open the Krythor dashboard at **http://localhost:47200**.
2. Go to **Settings → Chat Channels** tab.
3. Click **+ Add Channel**.
4. Select the channel type (Telegram, Discord, or WhatsApp).
5. Follow the setup steps for your chosen channel (see below).
6. Click **Save**. The channel status will update as the connection is established.

---

## Telegram Setup

### 1. Create a bot via @BotFather

1. Open Telegram and start a conversation with **@BotFather**.
2. Send `/newbot` and follow the prompts to choose a name and username for your bot.
3. BotFather will reply with a **bot token** — a string like `7123456789:AAHdqTcvCH...`. Copy it.

### 2. Add the channel in Krythor

1. In **Settings → Chat Channels**, click **+ Add Channel** and choose **Telegram**.
2. Paste the bot token into the **Bot Token** field.
3. Optionally assign a specific agent to handle Telegram messages. If left blank, the default agent is used.
4. Click **Save**.

Krythor will start polling the Telegram Bot API for incoming messages. Status will change to `connected` once the first poll succeeds.

### Credentials required

| Field | Description |
|-------|-------------|
| Bot Token | The token from @BotFather (format: `<number>:<string>`) |

No pairing step is required for Telegram.

### Access control

Telegram channels support the following access control settings. These can be configured via the API (`PUT /api/chat-channels/:id`) or by editing the channel config directly.

| Field | Default | Description |
|-------|---------|-------------|
| `dmPolicy` | `pairing` | How to handle direct messages: `pairing` (require pairing code), `allowlist` (configured senders only), `open` (anyone), `disabled` |
| `groupPolicy` | `allowlist` | How to handle group messages: `allowlist` (groups must be listed in `groups`), `open` (any group), `disabled` |
| `allowFrom` | `[]` | Array of Telegram user IDs allowed to DM the bot (used with `dmPolicy: allowlist`) |
| `groups` | `{}` | Map of group chat IDs to group config: `{ requireMention, allowFrom }` |
| `resetTriggers` | `["/new"]` | Messages that start a new conversation session for the sender |

### Context and delivery settings

| Field | Default | Description |
|-------|---------|-------------|
| `historyLimit` | `50` | Maximum number of past messages injected as context per turn. Set to `0` to disable. |
| `textChunkLimit` | `4096` | Maximum characters per outbound message. Longer replies are split into multiple messages. |
| `chunkMode` | `length` | How to split long replies: `length` (hard split) or `newline` (prefer paragraph boundaries). |
| `ackReaction` | `👀` | Emoji reaction sent on the triggering message when it is accepted for processing. Set to `""` to disable. |

---

## Discord Setup

### 1. Create a Discord application and bot

1. Go to the **[Discord Developer Portal](https://discord.com/developers/applications)** and sign in.
2. Click **New Application** and give it a name.
3. In the left sidebar, click **Bot**.
4. Click **Add Bot** and confirm.
5. Under **TOKEN**, click **Reset Token** and then **Copy** to copy your bot token.
6. Copy the **Application ID** from the **General Information** page.
7. Under **Bot → Privileged Gateway Intents**, enable **Message Content Intent** (required to read message content).
8. Use the **OAuth2 → URL Generator** to create an invite link: select the `bot` scope and at minimum the `Send Messages` and `Read Message History` permissions. Open the generated URL to invite the bot to your server.

### 2. Add the channel in Krythor

1. In **Settings → Chat Channels**, click **+ Add Channel** and choose **Discord**.
2. Paste the **Bot Token** and **Application ID** into the respective fields.
3. Optionally assign a specific agent.
4. Click **Save**.

Status will change to `connected` once the bot successfully connects to the Discord Gateway.

### Credentials required

| Field | Description |
|-------|-------------|
| Bot Token | The token from the Discord Developer Portal Bot page |
| Application ID | The Application ID from the General Information page |

No pairing step is required for Discord.

### Access control

| Field | Default | Description |
|-------|---------|-------------|
| `dmPolicy` | `pairing` | DM access policy: `pairing`, `allowlist`, `open`, `disabled` |
| `groupPolicy` | `open` | Guild channel policy: `open` (anyone in the channel), `allowlist` (configured senders only), `disabled` |
| `allowFrom` | `[]` | User IDs allowed when using `allowlist` policies |

### Context and delivery settings

| Field | Default | Description |
|-------|---------|-------------|
| `historyLimit` | `50` | Maximum context messages per turn. `0` = disabled. |
| `textChunkLimit` | `2000` | Max chars per outbound message (Discord limit). Longer replies are split. |
| `chunkMode` | `length` | Split strategy: `length` or `newline`. |

---

## WhatsApp Setup

WhatsApp integration uses a WhatsApp Business API-compatible library. Because the library is large and not needed by all users, it is installed on demand when you first add a WhatsApp channel.

### 1. Trigger the on-demand install

1. In **Settings → Chat Channels**, click **+ Add Channel** and choose **WhatsApp**.
2. Krythor will check whether the required package is installed. If not, it will show an **Install** button.
3. Click **Install**. The gateway will run `npm install` in the background and display progress. Status changes to `installed` when complete.

### 2. Enter credentials

After the package is installed, you will be prompted to enter your WhatsApp credentials (phone number and account details as required by the underlying library).

Click **Save & Pair**.

### 3. Pairing code flow

WhatsApp requires a one-time device pairing step:

1. After submitting credentials, Krythor generates a **pairing code** and displays it in the UI.
2. On your phone, open WhatsApp and go to **Settings → Linked Devices → Link a Device**.
3. When prompted, choose **Link with Phone Number instead** and enter the pairing code displayed by Krythor.
4. WhatsApp will confirm the pairing on your phone. The channel status in Krythor will change to `awaiting_pairing` while waiting, then to `connected` once the pairing succeeds.

### Credentials required

| Field | Description |
|-------|-------------|
| Phone Number | The WhatsApp Business phone number |
| Account credentials | As required by the underlying provider library |

The pairing code is required. The pairing step only needs to be completed once; subsequent reconnections are automatic using stored session credentials.

---

## API Reference

All chat channel endpoints are under `/api/chat-channels/` and require a Bearer token.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/chat-channels/` | List all configured channels |
| POST | `/api/chat-channels/` | Create a new channel |
| GET | `/api/chat-channels/:id` | Get a single channel (secrets masked) |
| PUT | `/api/chat-channels/:id` | Update channel configuration |
| DELETE | `/api/chat-channels/:id` | Remove a channel |
| POST | `/api/chat-channels/:id/connect` | Trigger a (re)connection attempt |
| POST | `/api/chat-channels/:id/disconnect` | Disconnect a channel without deleting it |
| GET | `/api/chat-channels/:id/status` | Get the current status of a channel |
| POST | `/api/chat-channels/:id/pairing-code` | Request a new WhatsApp pairing code |

---

## Credential Security

- Credentials are stored encrypted in the Krythor configuration directory (same encryption used for AI provider API keys).
- All `/api/chat-channels/` responses mask secret fields — bot tokens and passwords are returned as `"••••••••"` in API responses and in the UI.
- Credentials are only ever sent in plaintext when you enter them in the setup form; they are encrypted before being written to disk.
- No channel credentials are included in config exports unless you explicitly choose to include secrets.
