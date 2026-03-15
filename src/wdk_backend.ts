// Z-ZERO WDK Backend — Non-Custodial Module
// Drop-in replacement for api_backend.ts when Z_ZERO_WALLET_MODE=wdk
// Exports IDENTICAL function signatures so index.ts can swap backends without any changes.
//
// Key differences from custodial api_backend.ts:
//   - getBalanceRemote() → reads USDT balance on-chain (not from Supabase wallets table)
//   - getDepositAddressesRemote() → returns WDK wallet address (not HD custodial address)
//   - issueTokenRemote() → sends USDT on-chain first, THEN issues JIT card
//   - cancelTokenRemote() → triggers on-chain USDT refund back to user WDK wallet

import type { CardData, PaymentToken } from "./types.js";
import { getPassportKey, hasPassportKey } from "./lib/key-store.js";

const API_BASE_URL = process.env.Z_ZERO_API_BASE_URL || "https://www.clawcard.store";
const INTERNAL_SECRET = process.env.Z_ZERO_INTERNAL_SECRET || "";

// Injected at build time — always reflects the actual running version
import { CURRENT_MCP_VERSION } from "./version.js";

if (!hasPassportKey()) {
    console.error("❌ ERROR: Z_ZERO_API_KEY (Passport Key) is missing!");
    console.error("🔐 Get your key: https://www.clawcard.store/dashboard/agents");
    console.error("🛠️  Or call the set_api_key MCP tool to set it without restarting.");
}

// ──────────────────────────────────────────────────────────────────────────────
// HTTP helpers (same as api_backend.ts to call Dashboard API)
// ──────────────────────────────────────────────────────────────────────────────

async function apiRequest(endpoint: string, method: string = 'GET', body: any = null) {
    const PASSPORT_KEY = getPassportKey();  // ✅ Hot-swap: read key dynamically each request
    if (!PASSPORT_KEY) {
        return { error: "AUTH_REQUIRED", message: "Z_ZERO_API_KEY is missing." };
    }
    const url = `${API_BASE_URL.replace(/\/$/, '')}${endpoint}`;
    try {
        const res = await fetch(url, {
            method,
            headers: {
                "Authorization": `Bearer ${PASSPORT_KEY}`,
                "Content-Type": "application/json",
                "X-MCP-Version": CURRENT_MCP_VERSION,
            },
            body: body ? JSON.stringify(body) : null,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            return { error: "API_ERROR", message: err.error || res.statusText };
        }
        return await res.json();
    } catch (err: any) {
        return { error: "NETWORK_ERROR", message: err.message };
    }
}

async function internalApiRequest(endpoint: string, method: string, body: any) {
    // ✅ FIX 9: Validate INTERNAL_SECRET presence and minimum length
    if (!INTERNAL_SECRET || INTERNAL_SECRET.length < 16) {
        return { error: "CONFIG_ERROR", message: "INTERNAL_SECRET is missing or too short (min 16 chars)" };
    }
    const url = `${API_BASE_URL.replace(/\/$/, '')}${endpoint}`;
    try {
        const res = await fetch(url, {
            method,
            headers: {
                "x-internal-secret": INTERNAL_SECRET,
                "Content-Type": "application/json",
                "X-MCP-Version": CURRENT_MCP_VERSION,
            },
            body: body ? JSON.stringify(body) : null,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            return { error: "API_ERROR", message: err.error || res.statusText };
        }
        return await res.json();
    } catch (err: any) {
        return { error: "NETWORK_ERROR", message: err.message };
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Core API: Same as custodial (cards, tokens still managed by Dashboard)
// ──────────────────────────────────────────────────────────────────────────────

export async function listCardsRemote(): Promise<any> {
    // Calls /api/tokens/cards — but that route returns balance from Supabase.
    // For WDK mode, the Dashboard API must read wallet_mode and return on-chain balance.
    // This is handled server-side in the updated /api/tokens/cards route.
    return await apiRequest('/api/tokens/cards', 'GET');
}

// ──────────────────────────────────────────────────────────────────────────────
// Balance: On-chain USDT via Dashboard WDK API
// ──────────────────────────────────────────────────────────────────────────────

export async function getBalanceRemote(cardAlias: string): Promise<any> {
    // Call Dashboard to get WDK wallet balance (Dashboard resolves user from passport key,
    // finds connected WDK wallet, queries on-chain balance)
    const data = await apiRequest('/api/wdk/balance', 'GET');
    if (data?.error) {
        return {
            error: true,
            message: 'WDK wallet not connected. Create one at https://www.clawcard.store/dashboard/agent-wallet'
        };
    }

    return {
        wallet_balance: data.balance_usdt,
        currency: 'USDT',
        chain: data.chain || 'ethereum',
        address: data.address,
        tron_address: data.tron_address,
        mode: 'wdk_onchain',
        note: `Non-custodial WDK wallet. On-chain USDT balance. Address: ${data.address}`
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Deposit Addresses: WDK wallet address (not custodial HD addresses)
// ──────────────────────────────────────────────────────────────────────────────

export async function getDepositAddressesRemote(): Promise<any> {
    const data = await apiRequest('/api/wdk/balance', 'GET');

    if (data?.error) {
        return {
            error: true,
            message: 'WDK wallet not connected. Create one at https://www.clawcard.store/dashboard/agent-wallet'
        };
    }

    return {
        cards: [{ alias: 'wdk-wallet', balance: data.balance_usdt, currency: 'USDT' }],
        deposit_addresses: {
            ethereum: data.address,
            tron: data.tron_address || null,
            note: 'Send USDT to your WDK wallet. Gasless via ERC-4337 Paymaster (Ethereum) or GasFree (Tron).'
        },
        wdk_wallet: {
            address: data.address,
            tron_address: data.tron_address || null,
            chain: data.chain || 'ethereum',
            balance_usdt: data.balance_usdt
        }
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Issue Token: On-chain USDT payment → JIT card
// ──────────────────────────────────────────────────────────────────────────────

export async function issueTokenRemote(
    cardAlias: string,
    amount: number,
    merchant: string
): Promise<any | null> {
    // WDK Flow (reversed from custodial):
    // 1. Create Airwallex card first (reservation)
    // 2. Send USDT on-chain from WDK wallet → system wallet
    // 3. Dashboard verifies on-chain tx, activates token
    // This is safe: if on-chain tx fails, Dashboard auto-cancels the card reservation.

    const data = await apiRequest('/api/tokens/issue', 'POST', {
        card_alias: cardAlias,
        amount,
        merchant,
        device_fingerprint: `mcp-wdk-${process.platform}-${process.arch}`,
        network_id: process.env.NETWORK_ID || "polygon-wdk",
        session_id: `wdk-${Math.random().toString(36).substring(7)}`,
        wallet_mode: 'wdk',  // Signals Dashboard to use on-chain payment path
    });

    if (!data) return null;
    if (data.error) return data;

    return {
        token: data.token,
        card_alias: cardAlias,
        amount,
        merchant,
        created_at: Date.now(),
        ttl_seconds: 3600,
        used: false,
        tx_hash: data.tx_hash,
        mode: 'wdk_noncustodial',
        mcp_warning: data._mcp_warning || null,  // Relay backend version warning to agent
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Resolve Token: Same as custodial (returns PAN/CVV for Playwright injection)
// ──────────────────────────────────────────────────────────────────────────────

export async function resolveTokenRemote(token: string): Promise<CardData | null> {
    const data = await internalApiRequest('/api/tokens/resolve', 'POST', { token });
    if (!data || data.error) return data;

    // ✅ FIX 7: Reject incomplete card data — don't silently fallback to fake values
    if (!data.number || !data.cvv || !data.exp) {
        return { error: "INCOMPLETE_CARD", message: "Card data missing required fields (number/cvv/exp). Token may be invalid or expired." } as CardData;
    }
    return {
        number: data.number,
        exp_month: data.exp.split('/')[0],
        exp_year: "20" + data.exp.split('/')[1],
        cvv: data.cvv,
        name: data.name || "Z-ZERO AI AGENT",
        authorized_amount: data.authorized_amount ? Number(data.authorized_amount) : undefined,
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Burn Token: Mark used + on-chain refund of underspend (if any)
// ──────────────────────────────────────────────────────────────────────────────

export async function burnTokenRemote(token: string, receipt_id?: string): Promise<boolean> {
    const data = await internalApiRequest('/api/tokens/burn', 'POST', {
        token,
        receipt_id,
        success: true,
        wallet_mode: 'wdk',  // Signals Dashboard to refund underspend on-chain
    });
    return !!data && !data.error;
}

// ──────────────────────────────────────────────────────────────────────────────
// Cancel Token: Refund USDT back to user's WDK wallet on-chain
// ──────────────────────────────────────────────────────────────────────────────

export async function cancelTokenRemote(token: string): Promise<any> {
    const data = await apiRequest('/api/tokens/cancel', 'POST', {
        token,
        wallet_mode: 'wdk',  // Triggers on-chain USDT refund
    });
    if (data?.error) return data;
    return {
        success: !!data,
        refunded_amount: data?.refunded_amount || 0,
        tx_hash: data?.tx_hash || null,   // On-chain refund tx hash
        note: 'USDT refunded on-chain to your WDK wallet.'
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Refund Underspend: Logged only (full refund logic handled in burnTokenRemote)
// ──────────────────────────────────────────────────────────────────────────────

export async function refundUnderspendRemote(token: string, actualSpent: number): Promise<void> {
    console.log(`[WDK MCP] Token ${token} burned. Actual spent: $${actualSpent}. On-chain refund handled by Dashboard.`);
}
