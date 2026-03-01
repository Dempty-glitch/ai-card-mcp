#!/usr/bin/env node
// AI Virtual Card MCP Server
// Exposes secure payment tools to AI Agents via Model Context Protocol

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
    issueToken,
    resolveToken,
    burnToken,
    getBalance,
    listCards,
} from "./mock_backend.js";
import { fillCheckoutForm } from "./playwright_bridge.js";

// ============================================================
// CREATE MCP SERVER
// ============================================================
const server = new McpServer({
    name: "ai-card-mcp",
    version: "0.1.0",
});

// ============================================================
// TOOL 1: List available cards (safe - no sensitive data)
// ============================================================
server.tool(
    "list_cards",
    "List all available virtual card aliases and their balances. No sensitive data is returned.",
    {},
    async () => {
        const cards = listCards();
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            cards,
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
            .describe(
                "The alias of the card to check, e.g. 'Card_01'"
            ),
    },
    async ({ card_alias }) => {
        const balance = getBalance(card_alias);
        if (!balance) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Card "${card_alias}" not found. Use list_cards to see available cards.`,
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
                        { card_alias, ...balance },
                        null,
                        2
                    ),
                },
            ],
        };
    }
);

// ============================================================
// TOOL 3: Request a temporary payment token
// ============================================================
server.tool(
    "request_payment_token",
    "Request a temporary payment token for a specific amount. The token is valid for 15 minutes and locked to the specified amount. Use this token with execute_payment to complete a purchase.",
    {
        card_alias: z
            .string()
            .describe("Which card to charge, e.g. 'Card_01'"),
        amount: z
            .number()
            .positive()
            .describe("Amount in USD to authorize"),
        merchant: z
            .string()
            .describe(
                "Name or URL of the merchant/service being purchased"
            ),
    },
    async ({ card_alias, amount, merchant }) => {
        const token = issueToken(card_alias, amount, merchant);
        if (!token) {
            const balance = getBalance(card_alias);
            return {
                content: [
                    {
                        type: "text" as const,
                        text: balance
                            ? `Insufficient balance. Card "${card_alias}" has $${balance.balance} but you requested $${amount}.`
                            : `Card "${card_alias}" not found.`,
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
                            instructions:
                                "Use this token with execute_payment tool within 15 minutes.",
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
            .describe(
                "The temporary payment token from request_payment_token"
            ),
        checkout_url: z
            .string()
            .url()
            .describe("The full URL of the checkout/payment page"),
    },
    async ({ token, checkout_url }) => {
        // Step 1: Resolve token -> card data (RAM only)
        const cardData = resolveToken(token);
        if (!cardData) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: "Payment failed: Token is invalid, expired, or already used. Request a new token.",
                    },
                ],
                isError: true,
            };
        }

        // Step 2: Use Playwright to inject card into checkout form
        const result = await fillCheckoutForm(checkout_url, cardData);

        // Step 3: Burn the token (one-time use only)
        burnToken(token);

        // Step 4: Return result (NEVER includes card numbers)
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
// START SERVER
// ============================================================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🔐 AI Virtual Card MCP Server running...");
    console.error("Tools: list_cards, check_balance, request_payment_token, execute_payment");
}

main().catch(console.error);
