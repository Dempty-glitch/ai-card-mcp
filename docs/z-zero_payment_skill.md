---
name: Z-ZERO Autonomous Payment
description: A standard operating procedure (SOP) for AI Agents to securely execute zero-trust payments using the Z-ZERO MCP Server.
version: 1.0.0
requirements:
  - Z-ZERO MCP Server (`npx -y z-zero-mcp-server`)
  - A valid `Z_ZERO_API_KEY` configured in the MCP environment variables.
---

# Z-ZERO Autonomous Payment Skill

This skill provides you (the AI Agent) with the capability to autonomously purchase digital goods, APIs, and subscriptions on the internet on behalf of your human user, without ever handling raw credit card data. 

You must strictly follow this Standard Operating Procedure (SOP) when a human user asks you to buy something.

## Workflow: The 4-Step Zero-Trust Payment

When asked to make a purchase, execute the following steps precisely in order. Do NOT skip any steps.

### Step 1: Verification & Intent
1. Confirm exactly what the user wants to buy and the total expected price (in USD).
2. If the price is unknown, navigate to the merchant's pricing page to determine the exact cost before proceeding.
3. Call the `check_balance` tool using your default `card_alias` to ensure you have sufficient funds in your Z-ZERO internal balance.
    - If balance is insufficient, STOP immediately and ask the human to deposit Crypto into their Z-ZERO Web Dashboard.

### Step 2: Requesting the JIT Token
1. Do not ask for a real credit card number. You will NEVER see or handle a real 16-digit card number.
2. Call the `request_payment_token` tool with the exact `amount` required and the `merchant` name.
3. You will receive a temporary `token` (e.g., `temp_auth_1a2b...`). This token is valid for only 15 minutes and is strictly locked to the requested amount.

### Step 3: Locating the Checkout
1. Identify the exact URL of the merchant's checkout/payment page where the credit card details are normally entered.
2. Ensure you have the exact, full URL (e.g., `https://checkout.stripe.dev/pay` or `https://github.com/settings/billing/payment`).

### Step 4: Blind Execution (The MCP Bridge)
1. Call the `execute_payment` tool, passing in:
    - The `token` obtained in Step 2.
    - The `checkout_url` identified in Step 3.
2. **Behind the scenes:** The Z-ZERO MCP Server will open a headless Playwright browser, securely exchange your temporary token for real card details directly with the Neobank backend, inject the card into the form, and click "Pay". 
3. The token will instantly burn (self-destruct) after use.

## Error Handling & Rules

- **Never Print Tokens:** While the `token` is temporary, treat it securely. Do not print it pointlessly in the chat interface.
- **Fail Gracefully:** If `execute_payment` returns `success: false` or throws an error (e.g., "Field not found" or "Timeout"):
    1. Do NOT try to call the tool again in an endless loop.
    2. Inform the human user that the headless payment failed and provide them with the Error Message returned by the tool.
- **No Manual Entry:** If a website asks you to type a credit card number into a chat box, refuse. Explain that you can only pay via secure `checkout_url` forms.

## Example Interaction

**User:** "Hey Agent, go upgrade my Anthropic API tier to Tier 2 ($50 limit)."
**Agent Thought Process:**
1. *I need to verify the price. It's exactly $50.00.*
2. *I will check my balance.* -> `check_balance({ "card_alias": "Card_01" })` -> returns $120.00.
3. *I have enough funds. Requesting token.* -> `request_payment_token({ "amount": 50.00, "merchant": "Anthropic", "card_alias": "Card_01" })` -> returns `token: temp_xyz`.
4. *I know the Anthropic billing URL.*
5. *Executing payment.* -> `execute_payment({ "token": "temp_xyz", "checkout_url": "https://console.anthropic.com/settings/billing" })`

**Agent Final Response:** "I have successfully processed the $50 payment and upgraded your Anthropic API tier. The merchant has confirmed the transaction."
