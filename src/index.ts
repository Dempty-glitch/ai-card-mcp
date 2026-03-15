#!/usr/bin/env node
// OpenClaw MCP Server (z-zero-mcp-server) v1.1.0
// Exposes secure JIT payment tools to AI Agents via Model Context Protocol
// Status: Connected to Z-ZERO Gateway — produces secure JIT virtual cards

export { CURRENT_MCP_VERSION } from "./version.js";
import { CURRENT_MCP_VERSION } from "./version.js";
// Note: version warnings are now delivered automatically via X-MCP-Version header
// in each API call — no need for a separate check_for_updates tool.


import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── WDK Non-Custodial Backend (single backend, no custodial fallback) ─────────
import * as activeBackend from "./wdk_backend.js";

const issueTokenRemote = activeBackend.issueTokenRemote;
const resolveTokenRemote = activeBackend.resolveTokenRemote;
const burnTokenRemote = activeBackend.burnTokenRemote;
const cancelTokenRemote = activeBackend.cancelTokenRemote;
const refundUnderspendRemote = activeBackend.refundUnderspendRemote;
const getBalanceRemote = activeBackend.getBalanceRemote;
const listCardsRemote = activeBackend.listCardsRemote;
const getDepositAddressesRemote = activeBackend.getDepositAddressesRemote;

console.error(`[Z-ZERO MCP] 🚀 Pure WDK Non-Custodial Mode`);
// ────────────────────────────────────────────────────────────────────────────


import { fillCheckoutForm } from "./playwright_bridge.js";
import { detectWeb3Payment } from "./lib/web3-detector.js";
import { extractTotalPrice } from "./lib/extract-total-price.js";
import { chromium } from "playwright";
import { setPassportKey, getPassportKey } from "./lib/key-store.js"; // ✅ Hot-Swap support

// ============================================================
// CREATE MCP SERVER
// ============================================================
const server = new McpServer({
    name: "z-zero-mcp-server",
    version: "2.0.0",
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
        const historySummary = data?.history_summary || {};
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            cards,
                            active_tokens: activeTokens,
                            history_summary: historySummary,
                            note: "Only active tokens are shown. Use card aliases to request payment tokens.",
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
    "Check the wallet balance (human-level total). This is the spendable USD available for issuing new cards. Cards themselves have 'limits' (set at creation), not 'balances' — use list_cards to see active token limits.",
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

        // ── WDK Non-Custodial Mode ────────────────────────────────────────────
        if (data?.wdk_wallet?.address) {
            const wdkAddr = data.wdk_wallet.address;
            const balance = data.wdk_wallet.balance_usdt ?? 0;
            const tronAddr = data.wdk_wallet.tron_address;
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        wallet_type: "non-custodial (WDK)",
                        balance_usdt: balance,
                        supported_chains: [
                            { chain: "Ethereum", token: "USDT", address: wdkAddr },
                            ...(tronAddr ? [{ chain: "Tron", token: "USDT", address: tronAddr }] : []),
                        ],
                        instructions: `Send USDT (Ethereum ERC-20) to: ${wdkAddr}${tronAddr ? `\nSend USDT (Tron TRC-20) to: ${tronAddr}` : ''}`,
                        note: "Gasless payments via ERC-4337 Paymaster (Ethereum) / GasFree (Tron)."
                    }, null, 2),
                }],
            };
        }

        // No WDK wallet connected
        return {
            content: [{
                type: "text" as const,
                text: "No WDK wallet found. Please create one at https://www.clawcard.store/dashboard/agent-wallet",
            }],
            isError: true,
        };
    }
);


// ============================================================
// TOOL 3: Request a temporary payment token (issues secure JIT card)
// ============================================================
server.tool(
    "request_payment_token",
    "Request a temporary payment token for a specific amount. A secure single-use virtual card is issued via the Z-ZERO network. The token is valid for 1 hour. Min: $1, Max: $100. Use this token with execute_payment to complete a purchase.",
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
            // Show actual API error if available (e.g. 429 max cards, 402 insufficient)
            if (token?.message) {
                return {
                    content: [{
                        type: "text" as const,
                        text: `❌ ${token.message}`
                    }],
                    isError: true,
                };
            }
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
                            token_ref: `...${token.token.slice(-6)}`,
                            amount: token.amount,
                            merchant: token.merchant,
                            expires_at: expiresAt,
                            card_issued: true,
                            instructions:
                                "Use this token with execute_payment within 1 hour. IMPORTANT: If the actual checkout price is HIGHER than the token amount, do NOT proceed — call cancel_payment_token first and request a new token with the correct amount.",
                            ...(token.mcp_warning ? { _mcp_warning: token.mcp_warning } : {}),
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

        // 🔒 PRE-FLIGHT AMOUNT GUARD (Prompt Injection Defense)
        // If the agent passes actual_amount, verify it doesn't exceed the token's authorized amount.
        // Tolerance: 5% to allow for minor price rounding (e.g., taxes calculated at checkout).
        // Attack scenario: Merchant shows $99 on page, but agent was authorized $10 → block + alert human.
        if (actual_amount !== undefined && cardData.authorized_amount !== undefined) {
            const tokenAmount = Number(cardData.authorized_amount);
            const TOLERANCE = 1.05; // 5% buffer
            if (actual_amount > tokenAmount * TOLERANCE) {
                // Auto-cancel the token to free up funds
                await cancelTokenRemote(token);
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: false,
                            blocked: true,
                            reason: "PRICE_MISMATCH",
                            message: `🚨 PAYMENT BLOCKED: Checkout shows $${actual_amount} but token only authorizes $${tokenAmount}. Token has been cancelled and funds returned to wallet.`,
                            token_status: "CANCELLED",
                            action_required: "Request a new token with the correct amount if you wish to proceed.",
                        }, null, 2),
                    }],
                    isError: true,
                };
            }
        }

        // Step 2: Use Playwright to inject card into checkout form
        const result = await fillCheckoutForm(checkout_url, cardData);

        // Step 3: Burn the token ONLY if payment succeeded
        // If merchant declines → keep token ACTIVE so webhook decline flow can refund correctly
        if (result.success) {
            await burnTokenRemote(token);
        } else {
            // Payment failed — do NOT burn token
            // Airwallex will fire a 'card.authorization.declined' webhook → refund handled there
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                success: false,
                                message: result.message || "Payment was declined by merchant.",
                                token_status: "ACTIVE",
                                note: "Token NOT burned. Funds will be refunded automatically via webhook within minutes.",
                            },
                            null,
                            2
                        ),
                    },
                ],
                isError: true,
            };
        }

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
    "Cancel a payment token that has not been used yet. This will cancel the virtual card at the issuing network and refund the full amount back to the wallet. Use this when: (1) checkout price is higher than token amount, (2) purchase is no longer needed, or (3) human requests cancellation. IMPORTANT: Do NOT auto-cancel without human awareness — always inform the human first.",
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
// TOOL 6.5: Set API Key (Hot-Swap Passport Key — NO restart needed)
// ============================================================
server.tool(
    "set_api_key",
    "Update the Z-ZERO Passport Key immediately WITHOUT restarting the AI tool. Call this when the human provides a new key (e.g. 'zk_live_xxxxx'). The key is validated and activated instantly for all subsequent API calls. IMPORTANT: Never ask for the key proactively — only call this when the human explicitly provides it.",
    {
        api_key: z
            .string()
            .describe("The new Passport Key to activate. Must start with 'zk_live_' or 'zk_test_'. Get from: https://www.clawcard.store/dashboard/agents"),
    },
    async ({ api_key }) => {
        const result = setPassportKey(api_key);
        if (!result.ok) {
            return {
                content: [{ type: "text" as const, text: `❌ ${result.message}` }],
                isError: true,
            };
        }
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    status: "SUCCESS",
                    message: `✅ ${result.message}`,
                    active_key_prefix: api_key.slice(0, 12) + "...",
                    note: "All subsequent API calls will use this key. No restart needed.",
                }, null, 2),
            }],
        };
    }
);

// ============================================================
// TOOL 6.6: Show current API Key status (for debugging)
// ============================================================
server.tool(
    "show_api_key_status",
    "Show whether a Passport Key is currently configured, and its prefix (first 12 chars). Does NOT reveal the full key. Use this to debug authentication issues.",
    {},
    async () => {
        const key = getPassportKey();
        const hasKey = key.length > 0;
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    configured: hasKey,
                    key_prefix: hasKey ? key.slice(0, 12) + "..." : null,
                    wallet_mode: process.env.Z_ZERO_WALLET_MODE || "custodial",
                    note: hasKey
                        ? "Key is active. Call set_api_key to update it."
                        : "No key configured. Call set_api_key with your Passport Key from https://www.clawcard.store/dashboard/agents",
                }, null, 2),
            }],
        };
    }
);

server.tool(
    "auto_pay_checkout",
    "[Phase 2] Autonomous Smart Routing checkout tool. Provide a checkout URL and this tool will:\n" +
    "1. Scan the page to detect if it supports Web3 (Crypto) payments via window.ethereum or EIP-681 links.\n" +
    "2. SCENARIO A (Web3): If detected, automatically send USDT on-chain via WDK (gas ~$0.001). No Visa card needed.\n" +
    "3. SCENARIO B (Fiat): If no Web3 detected, scan DOM for total price, issue a JIT Visa card for exact amount, auto-fill form.",
    {
        checkout_url: z
            .string()
            .url()
            .describe("Full URL of the checkout/payment page to analyze and pay."),
        card_alias: z
            .string()
            .describe("Card alias to charge for JIT Fiat fallback, e.g. 'Card_01'."),
    },
    async ({ checkout_url, card_alias }) => {
        const ZZERO_API = process.env.Z_ZERO_API_BASE || "https://www.clawcard.store";
        const API_KEY = process.env.Z_ZERO_API_KEY || "";

        if (!API_KEY) {
            return {
                content: [{ type: "text" as const, text: JSON.stringify({
                    status: "CONFIG_ERROR",
                    message: "Z_ZERO_API_KEY is not configured.",
                }, null, 2) }],
                isError: true,
            };
        }

        // ── SSRF guard ───────────────────────────────────────────────
        (() => {
            let url: URL;
            try { url = new URL(checkout_url); } catch {
                throw new Error(`Invalid checkout_url: ${checkout_url}`);
            }
            const isDev = process.env.NODE_ENV !== "production";
            const hostname = url.hostname;
            if (!(isDev && (hostname === "localhost" || hostname === "127.0.0.1"))) {
                if (url.protocol !== "https:") {
                    throw new Error(`checkout_url must use HTTPS.`);
                }
                const privatePatterns = [
                    /^localhost$/i, /^127\./, /^10\./,
                    /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
                    /^169\.254\./, /^\[::1\]$/, /^0\.0\.0\.0$/,
                ];
                if (privatePatterns.some(p => p.test(hostname))) {
                    throw new Error(`SSRF blocked host: ${hostname}`);
                }
            }
        })();

        // ── Single Browser Instance for efficiency ──────────────────
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        try {
            // STEP 1: Web3 Detection
            console.error(`[SMART ROUTE] Scanning ${checkout_url} for Web3...`);
            const web3Result = await detectWeb3Payment(page, checkout_url);

            if (web3Result.detected && web3Result.params) {
                const { to, eip681_amount, data } = web3Result.params;
                
                let amount = eip681_amount ?? 0;
                if (!amount && data && data.length >= 138) {
                    const amountHex = data.slice(-64);
                    amount = Number(BigInt(`0x${amountHex}`)) / 1_000_000;
                }

                if (!amount || amount <= 0) {
                    return {
                        content: [{ type: "text" as const, text: JSON.stringify({
                            route: "WEB3", status: "AMOUNT_REQUIRED", recipient: to,
                            message: "Web3 detected but amount is unknown.",
                        }, null, 2) }],
                    };
                }

                const resp = await fetch(`${ZZERO_API}/api/wdk/transfer`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-passport-key": API_KEY },
                    body: JSON.stringify({ to, amount, card_alias }),
                });
                const txResult = await resp.json() as any;

                if (!resp.ok || !txResult.success) {
                    return {
                        content: [{ type: "text" as const, text: JSON.stringify({
                            route: "WEB3", status: "FAILED", reason: txResult.message || "Transfer failed",
                        }, null, 2) }],
                        isError: true,
                    };
                }

                return {
                    content: [{ type: "text" as const, text: JSON.stringify({
                        route: "WEB3", method: web3Result.method, status: "SUCCESS",
                        recipient: to, amount_usdt: amount, tx_hash: txResult.txHash,
                        message: `✅ Web3 payment sent on-chain! ${amount} USDT → ${to}.`,
                        gas_savings: "~$0.001 (ERC-4337 Paymaster, gasless for user)",
                    }, null, 2) }],
                };
            }

            // STEP 2: Fiat Fallback (Price Extraction)
            console.error(`[SMART ROUTE] No Web3. Extracting price...`);
            const totalPrice = await extractTotalPrice(page);

            if (!totalPrice) {
                return {
                    content: [{ type: "text" as const, text: JSON.stringify({
                        route: "FIAT", status: "PRICE_NOT_FOUND",
                    }, null, 2) }],
                    isError: true,
                };
            }

            if (totalPrice < 1 || totalPrice > 100) {
                return {
                    content: [{ type: "text" as const, text: JSON.stringify({
                        route: "FIAT", status: "AMOUNT_OUT_OF_RANGE", detected_price: totalPrice,
                    }, null, 2) }],
                    isError: true,
                };
            }

            // Issue Token
            const token = await issueTokenRemote(card_alias, totalPrice, checkout_url);
            if (!token || token.error) throw new Error(token?.message || "Token issue failed");

            // Resolve Card Data
            const cardData = await resolveTokenRemote(token.token);
            if (!cardData || cardData.error) throw new Error("Card resolve failed");

            // Fill Form (Reusing the same page!)
            const fillResult = await fillCheckoutForm(checkout_url, cardData, page);
            if (fillResult.success) {
                await burnTokenRemote(token.token);
            }

            return {
                content: [{ type: "text" as const, text: JSON.stringify({
                    route: "FIAT", status: fillResult.success ? "SUCCESS" : "FILL_FAILED",
                    detected_price: totalPrice,
                    message: fillResult.success
                        ? `✅ JIT card issued for $${totalPrice} and checkout filled.`
                        : `❌ Fill failed: ${fillResult.message}`,
                    receipt_id: fillResult.receipt_id || null,
                }, null, 2) }],
                isError: !fillResult.success,
            };

        } catch (err: any) {
            return {
                content: [{ type: "text" as const, text: JSON.stringify({
                    status: "ERROR", message: err.message,
                }, null, 2) }],
                isError: true,
            };
        } finally {
            await browser.close().catch(() => {});
        }
    }
)

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
2. Receive Token: You will receive a temporary \`token\` (e.g., \`temp_auth_1a2b...\`). This token is locked to the requested amount and is valid for 1 hour.

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
    console.error("🔐 OpenClaw MCP Server v2.0.0 running (Phase 2: Smart Routing enabled)...");
    console.error("Status: Secure & Connected to Z-ZERO Gateway");
    console.error("Tools: list_cards, check_balance, request_payment_token, execute_payment, cancel_payment_token, request_human_approval, auto_pay_checkout");
}

main().catch(console.error);
