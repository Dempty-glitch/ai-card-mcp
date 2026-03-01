# AI Virtual Card MCP Server - Implementation Plan

## Goal
Build an MVP MCP Server that allows AI Agents (Claude Desktop, etc.) to securely process payments using virtual cards without ever seeing real card numbers. Uses the **Tokenized JIT (Just-In-Time)** architecture.

## Tech Stack
- **Runtime**: Node.js + TypeScript
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Browser Automation**: Playwright
- **Security**: Node.js `crypto` module for encryption

## Project Structure

```
ai-card-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # MCP Server entry point
│   ├── mock_backend.ts       # Simulated Neobank API (token ↔ card)
│   ├── playwright_bridge.ts  # Invisible card injection into browser
│   └── types.ts              # Shared TypeScript types
└── test/
    └── test_stripe.ts        # Test against Stripe's test checkout
```

---

## Proposed Changes

### Mock Backend (Simulated Neobank)

#### [NEW] [mock_backend.ts](file:///Users/phamlehung/Documents/Claude_Course_Project/ai-card-mcp/src/mock_backend.ts)
- Simulates the Neobank API that would exist in production.
- **Card Vault**: In-memory store of virtual cards (`Card_01`, `Card_02`).
- **`issueToken(card_alias, amount)`**: Issues a JIT token (e.g., `temp_auth_XXXX`) with 15-minute TTL, locked to a specific amount.
- **`resolveToken(token)`**: Returns real card data ONLY if token is valid and unexpired. Data returned as a JS object in RAM (never serialized to disk/log).
- **`burnToken(token)`**: Immediately invalidates the token.

---

### MCP Server Core

#### [NEW] [index.ts](file:///Users/phamlehung/Documents/Claude_Course_Project/ai-card-mcp/src/index.ts)
Three tools exposed to AI Agents:

| Tool Name | Input | Output | Description |
|---|---|---|---|
| `request_payment_token` | `{ amount, merchant, card_alias }` | `{ token, expires_at }` | AI calls this to get a temporary payment token |
| `execute_payment` | `{ token, checkout_url }` | `{ success, receipt }` | AI calls this to pay. Playwright auto-fills card |
| `check_balance` | `{ card_alias }` | `{ balance, currency }` | AI checks remaining budget |

> [!IMPORTANT]
> The `execute_payment` tool NEVER returns card numbers in its response. It only returns `{ success: true/false, receipt: "..." }`.

---

### Playwright Bridge

#### [NEW] [playwright_bridge.ts](file:///Users/phamlehung/Documents/Claude_Course_Project/ai-card-mcp/src/playwright_bridge.ts)
- **`fillCheckoutForm(url, cardData)`**: Opens a headless Chromium browser, navigates to `checkout_url`, detects card input fields via CSS selectors/heuristics, injects card data from RAM, and clicks "Pay".
- **Field Detection Strategy**: Uses common CSS selectors for Stripe Elements (`.__PrivateStripeElement`), standard `<input>` fields (`name="cardnumber"`, `autocomplete="cc-number"`), and Shopify checkout forms.
- **RAM Wipe**: After injection, the `cardData` variable is overwritten with zeros and dereferenced for GC.

---

## Verification Plan

### Automated Test
1. Start the MCP Server locally.
2. Call `request_payment_token` → get a temp token.
3. Call `execute_payment` with the token against Stripe's test checkout page (`https://checkout.stripe.dev/`).
4. Verify: Payment succeeds, AI response contains NO card numbers, token is burned after use.

### Security Verification
- Inspect all MCP response payloads to confirm zero PII leakage.
- Attempt to reuse a burned token → must fail.
- Attempt to use a token after 15 minutes → must fail.
