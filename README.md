# OpenClaw: Z-ZERO AI Agent MCP Server

A Zero-Trust Payment Protocol built specifically for AI Agents using the [Model Context Protocol (MCP)](https://modelcontextprotocol.io). Give your local agents (Claude, Cursor, AntiGravity) the ability to make real-world purchases — securely, without ever seeing a real card number.

## How It Works

Instead of giving your AI direct access to a credit card number, OpenClaw issues **temporary, single-use JIT tokens**. The token is resolved in RAM, Playwright injects the card data directly into the payment form, and the virtual card is burned milliseconds later. Your AI never sees the PAN, CVV, or expiry.

---

## Quick Install (Recommended)

```bash
npx z-zero-mcp-server
```

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "openclaw": {
      "command": "npx",
      "args": ["-y", "z-zero-mcp-server@latest"],
      "env": {
        "Z_ZERO_API_KEY": "zk_live_your_passport_key_here"
      }
    }
  }
}
```

Get your Passport Key at: **[clawcard.store/dashboard/agents](https://www.clawcard.store/dashboard/agents)**

---

## Requirements

- **Node.js v18+** — [nodejs.org](https://nodejs.org)
- **Passport Key** — starts with `zk_live_`, get it from the dashboard above

---

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `list_cards` | View your virtual card aliases and balances |
| `check_balance` | Query a specific card's real-time balance |
| `get_deposit_addresses` | Get deposit addresses to top up your balance |
| `request_payment_token` | Generate a JIT auth token for a specific amount |
| `execute_payment` | Auto-fill checkout form and execute payment |
| `cancel_payment_token` | Cancel unused token, refund to wallet |
| `request_human_approval` | Pause and ask human for approval |
| `set_api_key` | **(Hot-Swap)** Update the Passport Key *without restarting Claude* |
| `show_api_key_status` | Check if a Passport Key is currently loaded |
| `check_for_updates` | **(Maintenance)** Check if a new MCP version is available |

---

## REST API Reference

The Z-ZERO backend is hosted at `https://www.clawcard.store`. All endpoints require a `Bearer` token using your Passport Key.

> ⚠️ **Use the MCP tools above instead of calling REST directly.** If you must call REST, use the exact paths below.

### `GET /api/tokens/cards`
Returns your card list, balance, and deposit addresses.
```bash
curl -X GET "https://www.clawcard.store/api/tokens/cards" \
  -H "Authorization: Bearer zk_live_your_key"
```

**Aliases (also work):**
- `GET /api/v1/cards` ← for agents that guess REST-style paths

### `POST /api/tokens/issue`
Issue a JIT payment token.

### `POST /api/tokens/resolve`
Resolve a token to card data (server-side only).

### `POST /api/tokens/burn`
Burn a used token.

### `POST /api/tokens/cancel`
Cancel an unused token (refunds balance).

---

## Troubleshooting

### "Z_ZERO_API_KEY is missing"
1. Go to [clawcard.store/dashboard/agents](https://www.clawcard.store/dashboard/agents)
2. Copy your Passport Key (starts with `zk_live_`)
3. Add it to your config as `Z_ZERO_API_KEY`
4. **Restart** Claude Desktop / Cursor

### "Invalid API Key" (401)
- Double-check you copied the full key (e.g. `zk_live_c0g3l`)
- Make sure there are no extra spaces or line breaks

### "404 Not Found" on `/api/v1/cards`
- This is a legacy path alias — it should now work. If not, use `/api/tokens/cards` directly.

---

*Security: OpenClaw never stores your Passport Key. It is passed via environment variables and card data exists only in volatile RAM during execution.*
