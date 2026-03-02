# Product Plan: AI Virtual Card Combo

## 1. The Core Concept
The product is a pre-packaged "Combo" designed to equip third-party AI Agents with secure payment capabilities. The Combo includes:
- **Virtual Card**: Pre-funded or assigned with a strict spending limit (e.g., $10, $50).
- **MCP Server Toolkit**: Acts as the "Secure Buffer Zone".

**Goal:** Enable customer AI Agents (like Claude Desktop, AutoGen, CrewAI) to autonomously purchase goods and subscribe to cloud services **without ever seeing the real 16-digit card number or CVV**. This prevents risks associated with prompt injection attacks or AI hallucination leading to unauthorized spending.

## 2. Distribution Models
How do we package this combo so strangers can plug it into their AI seamlessly? The solution is the **Dual-Interface Architecture**:

### 2.1. Z-ZERO Developer Portal (Human Gateway)
Human operators (Developers/DevOps) access a professional **Web Dashboard** to:
1. Log in via Web3 wallet (MetaMask/Phantom) or Email.
2. Deposit crypto collateral (USDC/USDT on Base/Arbitrum) to bypass traditional banking friction.
3. Create an "Agent Persona" and receive an `API_KEY` along with the `mcp_config.json` configuration file.
4. View transaction history, spending charts, and download reconciliation receipts.
*(Note: A chatbot is not used for management to ensure a professional and transparent B2B experience).*

### 2.2. MCP Server Toolkit (Agent Gateway)
The AI itself (Claude, AutoGPT) is "blind" to web interfaces; it simply installs our **MCP Server** toolkit (authenticating via the `API_KEY` obtained from the portal).
- The MCP server is installed locally on the customer's machine/server.
- When the AI needs to purchase a cloud quota or API, it calls the MCP tool: `request_payment_token()`.
- The MCP server automatically contacts the backend, retrieves a secure token, and runs Playwright in the background to inject card details directly into the merchant's checkout form.

### 2.3. Issuer Abstraction Layer
**Trade Secret:** The entire integration with a Neobank Partner is completely hidden within the Z-ZERO backend.
- The Web Dashboard and the customer's MCP server only call Z-ZERO's internal API (`api.z-zero.com`).
- Customers never know that Z-ZERO is calling the partner's API behind the scenes to provision the actual cards. This prevents competitors from copying the business model.

## 3. Ultimate Security Architecture: Tokenized JIT (Just-In-Time) Payment

This is the gold standard for distributing this product globally without security risks.

- **Step 1: Issue Token (Not Card Number)**
  Our backend returns a temporary token (e.g., `temp_auth_8892`) instead of the real card number. This token has an ultra-short lifespan (e.g., 15 minutes) and is strictly locked to the predefined amount.
- **Step 2: Distribute "Skill" (MCP Tool)** 
  The customer installs our MCP Server into their AI Agent. This server provides a pre-designed execution tool: `execute_payment(token, checkout_url)`.
- **Step 3: AI Commands (Blind Execution)**
  The customer's AI Agent only has access to the token. It decides to checkout and calls the function: `execute_payment("temp_auth_8892", "https://merchant.com/checkout")`.
- **Step 4: Local Execution (The Bridge)**
  The MCP script on the client machine receives the command. It runs in the background, sending `temp_auth_8892` to the Backend to exchange it for the real card details. **The card number exists solely in local RAM** (never printed to text logs or console). The MCP immediately uses Playwright to inject the card number into the merchant's DOM.
- **Step 5: Burn (Instant Destruction)**
  Immediately after the "Pay" button is clicked, the Token expires permanently, and the script's RAM is wiped. The one-time-use card disappears, reducing the risk of card leakage to absolute 0.

## 4. Next Steps
- Build the API architecture for the Backend (Supabase) to manage the Token issuance flow and transaction reconciliation.
- Create a dummy MCP Server containing the Playwright script to simulate "Step 4" (testing the injection of RAM data into the DOM).
