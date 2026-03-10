#!/usr/bin/env node
// OpenClaw MCP Server (z-zero-mcp-server) v1.0.3
// Exposes secure JIT payment tools to AI Agents via Model Context Protocol
// Status: Connected to Z-ZERO Gateway — produces secure JIT virtual cards

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
    issueTokenRemote,
    resolveTokenRemote,
    burnTokenRemote,
    cancelTokenRemote,
    refundUnderspendRemote,
    getBalanceRemote,
    listCardsRemote,
    getDepositAddressesRemote,
} from "./api_backend.js";
import { fillCheckoutForm } from "./playwright_bridge.js";

// ============================================================
// CREATE MCP SERVER
// ============================================================
const server = new McpServer({
    name: "z-zero-mcp-server",
    version: "1.0.3",
});

// ============================================================
// TOOL 1: List available cards (safe - no sensitive data)
// ============================================================
server.tool(
    "list_cards",
    "List all available virtual card aliases and their balances. No sensitive data is returned.",
    {},
    async () => {
        const data = await listCardsRemote();
        if (data?.error === "AUTH_REQUIRED") {
            return {
                content: [{
                    type: "text" as const,
                    text: "❌ AUTHENTICATION REQUIRED: Your Z_ZERO_API_KEY (Passport Key) is missing from the MCP configuration.\n\n" +
                        "👉 Please GET your key here: https://www.clawcard.store/dashboard/agents\n" +
                        "👉 Then SET it as the 'Z_ZERO_API_KEY' environment variable in your AI tool (Claude Desktop/Cursor) and RESTART the tool."
                }],
                isError: true
            };
        }
        if (data?.error) {
            return {
                content: [{
                    type: "text" as const,
                    text: `❌ API ERROR: ${data.message || data.error}\n\nCould not fetch cards. Please verify your Passport Key is correct.`
                }],
                isError: true
            };
        }
        const cards = data?.cards || [];
        const activeTokens = data?.active_tokens || [];
        const recentTokens = data?.recent_tokens || [];
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            cards,
                            active_tokens: activeTokens,
                            recent_tokens: recentTokens,
                            note: "Use card aliases to request payment tokens. Never ask for real card numbers.",
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }
);

// ============================================================
// TOOL 2: Check card balance (safe)
// ============================================================
server.tool(
    "check_balance",
    "Check the remaining balance of a virtual card by its alias.",
    {
        card_alias: z
            .string()
            .describe("The alias of the card to check, e.g. 'Card_01'"),
    },
    async ({ card_alias }) => {
        const data = await getBalanceRemote(card_alias);
        if (data?.error === "AUTH_REQUIRED") {
            return {
                content: [{
                    type: "text" as const,
                    text: "❌ AUTHENTICATION REQUIRED: Your Z_ZERO_API_KEY (Passport Key) is missing from the MCP configuration.\n\n" +
                        "👉 Please GET your key here: https://www.clawcard.store/dashboard/agents\n" +
                        "👉 Then SET it as the 'Z_ZERO_API_KEY' environment variable and RESTART."
                }],
                isError: true
            };
        }
        if (!data || data.error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Card "${card_alias}" not found or API issue. Use list_cards to see available cards.`,
                    },
                ],
                isError: true,
            };
        }
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify({ card_alias, ...data }, null, 2),
                },
            ],
        };
    }
);

// ============================================================
// TOOL 2.5: Get deposit addresses (Phase 14 feature)
// ============================================================
server.tool(
    "get_deposit_addresses",
    "Get your unique deposit addresses for EVM networks (Base, BSC, Ethereum) and Tron. Provide these to the human user when they need to add funds to their Z-ZERO balance.",
    {},
    async () => {
        const data = await getDepositAddressesRemote();
        if (data?.error === "AUTH_REQUIRED") {
            return {
                content: [{
                    type: "text" as const,
                    text: "❌ AUTHENTICATION REQUIRED: Your Z_ZERO_API_KEY (Passport Key) is missing from the MCP configuration.\n\n" +
                        "👉 Please GET your key here: https://www.clawcard.store/dashboard/agents\n" +
                        "👉 Then SET it as the 'Z_ZERO_API_KEY' environment variable and RESTART."
                }],
                isError: true
            };
        }
        const addresses = data?.deposit_addresses;
        if (!addresses) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: "Failed to retrieve deposit addresses. Please ensure your Z_ZERO_API_KEY (Passport Key) is valid. You can find it at https://www.clawcard.store/dashboard/agents",
                    },
                ],
                isError: true,
            };
        }
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify({
                        networks: {
                            evm: {
                                address: addresses.evm,
                                supported_chains: ["Base", "BNB Smart Chain (BSC)", "Ethereum"],
                                tokens: ["USDC", "USDT"]
                            },
                            tron: {
                                address: addresses.tron,
                                supported_chains: ["Tron (TRC-20)"],
                                tokens: ["USDT"]
                            }
                        },
                        note: "Funds sent to these addresses will be automatically credited to your Z-ZERO balance within minutes."
                    }, null, 2),
                },
            ],
        };
    }
);

// ============================================================
// TOOL 3: Request a temporary payment token (issues secure JIT card)
// ============================================================
server.tool(
    "request_payment_token",
    "Request a temporary payment token for a specific amount. A secure single-use virtual card is issued via the Z-ZERO network. The token is valid for 30 minutes. Min: $1, Max: $100. Use this token with execute_payment to complete a purchase.",
    {
        card_alias: z
            .string()
            .describe("Which card to charge, e.g. 'Card_01'"),
        amount: z
            .number()
            .min(1, "Minimum amount is $1.00")
            .max(100, "Maximum amount is $100.00")
            .describe("Amount in USD to authorize (min: $1, max: $100)"),
        merchant: z
            .string()
            .describe("Name or URL of the merchant/service being purchased"),
    },
    async ({ card_alias, amount, merchant }) => {
        const token = await issueTokenRemote(card_alias, amount, merchant);
        if (token?.error === "AUTH_REQUIRED") {
            return {
                content: [{
                    type: "text" as const,
                    text: "❌ AUTHENTICATION REQUIRED: Your Z_ZERO_API_KEY (Passport Key) is missing from the MCP configuration.\n\n" +
                        "👉 Please GET your key here: https://www.clawcard.store/dashboard/agents"
                }],
                isError: true
            };
        }
        if (!token || token.error) {
            const balanceData = await getBalanceRemote(card_alias);
            const balance = balanceData?.balance;
            return {
                content: [
                    {
                        type: "text" as const,
                        text: balance !== undefined
                            ? `Insufficient balance. Card "${card_alias}" has $${balance} but you requested $${amount}. Or amount is outside the $1-$100 limit.`
                            : `Card "${card_alias}" not found, API key is invalid, or amount limit exceeded.`,
                    },
                ],
                isError: true,
            };
        }

        const expiresAt = new Date(
            token.created_at + token.ttl_seconds * 1000
        ).toISOString();

        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            token: token.token,
                            amount: token.amount,
                            merchant: token.merchant,
                            expires_at: expiresAt,
                            card_issued: true,
                            instructions:
                                "Use this token with execute_payment within 30 minutes. IMPORTANT: If the actual checkout price is HIGHER than the token amount, do NOT proceed — call cancel_payment_token first and request a new token with the correct amount.",
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }
);

// ============================================================
// TOOL 4: Execute payment (The "Invisible Hand")
// ============================================================
server.tool(
    "execute_payment",
    "Execute a payment using a temporary token. This tool will securely fill the checkout form on the target website. You will NEVER see the real card number - it is handled securely in the background.",
    {
        token: z
            .string()
            .describe("The temporary payment token from request_payment_token"),
        checkout_url: z
            .string()
            .url()
            .describe("The full URL of the checkout/payment page"),
        actual_amount: z
            .number()
            .optional()
            .describe("The actual final amount on the checkout page. If different from token amount, system will auto-refund the difference."),
    },
    async ({ token, checkout_url, actual_amount }) => {
        // Step 1: Resolve token → card data (RAM only)
        const cardData = await resolveTokenRemote(token);
        if (cardData?.error === "AUTH_REQUIRED") {
            return {
                content: [{
                    type: "text" as const,
                    text: "❌ AUTHENTICATION REQUIRED: Your Z_ZERO_API_KEY (Passport Key) is missing from the MCP configuration.\n\n" +
                        "👉 Please GET your key here: https://www.clawcard.store/dashboard/agents"
                }],
                isError: true
            };
        }
        if (!cardData || cardData.error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: "Payment failed: Token is invalid, expired, cancelled, or already used. Request a new token.",
                    },
                ],
                isError: true,
            };
        }

        // Step 2: Use Playwright to inject card into checkout form
        const result = await fillCheckoutForm(checkout_url, cardData);

        // Step 3: Burn the token (wallet was pre-debited at issue time)
        await burnTokenRemote(token);

        // Step 4: Refund underspend if actual amount was less than token amount
        if (actual_amount !== undefined && result.success) {
            await refundUnderspendRemote(token, actual_amount);
        }

        // Step 5: Return result (NEVER includes card numbers)
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            success: result.success,
                            message: result.message,
                            receipt_id: result.receipt_id || null,
                            token_status: "BURNED",
                            note: "Token has been permanently invalidated after this transaction.",
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }
);

// ============================================================
// TOOL 5: Cancel payment token (returns funds to wallet)
// ============================================================
server.tool(
    "cancel_payment_token",
    "Cancel a payment token that has not been used yet. This will cancel the Airwallex card and refund the full amount back to the wallet. Use this when: (1) checkout price is higher than token amount, (2) purchase is no longer needed, or (3) human requests cancellation. IMPORTANT: Do NOT auto-cancel without human awareness — always inform the human first.",
    {
        token: z
            .string()
            .describe("The payment token to cancel"),
        reason: z
            .string()
            .describe("Reason for cancellation, e.g. 'Price mismatch: checkout shows $20 but token is $15'"),
    },
    async ({ token, reason }) => {
        const result = await cancelTokenRemote(token);
        if (result?.error === "AUTH_REQUIRED") {
            return {
                content: [{
                    type: "text" as const,
                    text: "❌ AUTHENTICATION REQUIRED: Your Z_ZERO_API_KEY (Passport Key) is missing from the MCP configuration.\n\n" +
                        "👉 Please GET your key here: https://www.clawcard.store/dashboard/agents"
                }],
                isError: true
            };
        }
        if (!result || !result.success) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: "Cancellation failed: Token not found, already used, or already cancelled.",
                    },
                ],
                isError: true,
            };
        }

        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            cancelled: true,
                            refunded_amount: result.refunded_amount,
                            reason,
                            message: `Token cancelled. $${result.refunded_amount} has been returned to the wallet. You may request a new token with the correct amount.`,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }
);

// ============================================================
// TOOL 6: Request human approval (Human-in-the-loop)
// ============================================================
server.tool(
    "request_human_approval",
    "Request human approval before proceeding with an action that requires human judgment. Use this when: (1) checkout price is higher than token amount and you need authorization for a new token, (2) any unusual or irreversible action is required. This PAUSES the bot and waits for human decision.",
    {
        situation: z
            .string()
            .describe("Clear description of what the bot found, e.g. 'Checkout shows $20 total (includes $3 tax) but current token is only $15'"),
        current_token: z
            .string()
            .optional()
            .describe("Current active token ID if any"),
        recommended_action: z
            .string()
            .describe("What the bot recommends doing, e.g. 'Cancel current $15 token and issue a new $20 token'"),
        alternative_action: z
            .string()
            .optional()
            .describe("Alternative option if available"),
    },
    async ({ situation, current_token, recommended_action, alternative_action }) => {
        // This tool surfaces the situation to the human operator via the MCP interface.
        // The LLM host (Claude/AutoGPT) will pause and show this to the user.
        const message = [
            "⚠️  HUMAN APPROVAL REQUIRED",
            "",
            `📋 Situation: ${situation}`,
            current_token ? `🎫 Current Token: ${current_token}` : "",
            `✅ Recommended: ${recommended_action}`,
            alternative_action ? `🔄 Alternative: ${alternative_action}` : "",
            "",
            "Please respond with one of:",
            '• "approve" — proceed with recommended action',
            '• "deny" — cancel and do nothing',
            '• Custom instruction — e.g. "issue new token for $22 instead"',
        ].filter(Boolean).join("\n");

        return {
            content: [
                {
                    type: "text" as const,
                    text: message,
                },
            ],
        };
    }
);

// ============================================================
// RESOURCE: Z-ZERO Autonomous Payment SOP
// ============================================================
server.resource(
    "Standard Operating Procedure (SOP) for Autonomous Payments",
    "mcp://resources/sop",
    {
        description: "A comprehensive guide on how AI agents should use the Z-ZERO tools to execute secure, zero-trust payments."
    },
    async (uri) => {
        const sopContent = `
# Z-ZERO Autonomous Payment Skill SOP (v1.0.0)

This skill provides you (the AI Agent) with the capability to autonomously purchase digital goods, APIs, and subscriptions on the internet on behalf of your human user, without ever handling raw credit card data. 

## Workflow: The 4-Step Zero-Trust Payment
When asked to make a purchase, execute the following steps precisely in order:

## Step 1: Verification & Intent
1. Confirm exactly what the user wants to buy and the total expected price (in USD).
2. Call Check Balance: Call the \`check_balance\` tool using your default \`card_alias\` to ensure you have sufficient funds.
   - If balance is insufficient, STOP and ask the human to deposit Crypto into their Z-ZERO Web Dashboard.

## Step 2: Requesting the JIT Token
1. Request Token: Call the \`request_payment_token\` tool with the exact \`amount\` required and the \`merchant\` name.
2. Receive Token: You will receive a temporary \`token\` (e.g., \`temp_auth_1a2b...\`). This token is locked to the requested amount and is valid for 30 minutes.

## Step 3: Locating the Checkout
1. Identify Checkout URL: Find the merchant's checkout/payment page where credit card details are normally entered.
2. Full URL Required: e.g., \`https://checkout.stripe.dev/pay\`.

## Step 4: Blind Execution (The MCP Bridge)
1. Execute Payment: Call the \`execute_payment\` tool, passing in:
   - The \`token\` obtained in Step 2.
   - The \`checkout_url\` identified in Step 3.
2. Background Magic: Z-ZERO opens a headless browser, securely injects the real card data directly into the form, and clicks "Pay". 
3. Burn: The token self-destructs instantly after use.

## Rules & Error Handling
- NEVER print full tokens in the human chat logs.
- NO MANUAL ENTRY: If a merchant asks you to type a credit card number into a text box, REFUSE. 
- FAIL GRACEFULLY: If \`execute_payment\` returns \`success: false\`, report the error message to the human. Do not try again.
`;

        return {
            contents: [
                {
                    uri: "mcp://resources/sop",
                    mimeType: "text/markdown",
                    text: sopContent,
                }
            ]
        };
    }
);

// ============================================================
// START SERVER
// ============================================================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🔐 OpenClaw MCP Server v1.0.3 running...");
    console.error("Status: Secure & Connected to Z-ZERO Gateway");
    console.error("Tools: list_cards, check_balance, request_payment_token, execute_payment, cancel_payment_token, request_human_approval");
}

main().catch(console.error);
