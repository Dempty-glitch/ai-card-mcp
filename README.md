# Z-ZERO: AI Virtual Card MCP Server

A Zero-Trust Payment Protocol built specifically for AI Agents utilizing the Model Context Protocol (MCP).

## The Concept (Tokenized JIT Payments)
This MCP server acts as an "Invisible Bridge" for your AI Agents. Instead of giving your LLM direct access to a 16-digit credit card number (which triggers safety filters and risks prompt injection theft), the AI only handles **temporary, single-use tokens**.

The local MCP client resolves the token securely in RAM, injects the real card data directly into the payment form (via Playwright headless browser), and clicks "Pay". The virtual card and token are burned milliseconds later.

## Features
- **Zero PII (Blind Execution):** AI never sees card numbers.
- **Exact-Match Funding:** Tokens are tied to virtual cards locked to the exact requested amount.
- **Phantom Burn:** Single-use architecture. Cards self-destruct after checking out.
- **Stripe/HTML Form Injection:** Automatically fills common checkout domains.

## Documentation
Check the `docs/` folder for complete system design and architecture:
- [Product Plan & Core Concept](docs/ai_card_product_plan.md)
- [MCP Implementation Plan](docs/implementation_plan.md)
- [Mock Backend Architecture](docs/backend_architecture.md)
- [Live Demo Walkthrough & Test Results](docs/walkthrough.md)

## Getting Started

### 1. Install Dependencies
```bash
npm install
npx playwright install chromium
```

### 2. Build the Server
```bash
npm run build
```

### 3. Usage with Claude Desktop
Add this to your `mcp_config.json`:
```json
{
  "mcpServers": {
    "ai-card-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/ai-card-mcp/dist/index.js"]
    }
  }
}
```

## Available MCP Tools
- `list_cards`: View available virtual cards and balances.
- `check_balance`: Query a specific card's real-time balance.
- `request_payment_token`: Generate a JIT auth token locked to a specific amount.
- `execute_payment`: Passes the token to the Playwright bridge to auto-fill the checkout URL and burn the token.
