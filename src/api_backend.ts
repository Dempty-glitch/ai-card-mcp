// Z-ZERO Unified API Backend
// Connects to the Dashboard Next.js API for all card and token operations.
// This preserves the "Issuer Abstraction Layer" - the bot never sees direct DB or Banking keys.

import type { CardData, PaymentToken } from "./types.js";

const API_BASE_URL = process.env.Z_ZERO_API_BASE_URL || "https://www.clawcard.store";
const PASSPORT_KEY = process.env.Z_ZERO_API_KEY || "";
const INTERNAL_SECRET = process.env.Z_ZERO_INTERNAL_SECRET || "";

if (!PASSPORT_KEY) {
    console.error("❌ ERROR: Z_ZERO_API_KEY (Passport Key) is missing!");
    console.error("🔐 Please get your Passport Key from: https://www.clawcard.store/dashboard/agents");
    console.error("🛠️ Setup: Ensure 'Z_ZERO_API_KEY' is set in your environment variables.");
}

async function apiRequest(endpoint: string, method: string = 'GET', body: any = null) {
    if (!PASSPORT_KEY) {
        return { error: "AUTH_REQUIRED", message: "Z_ZERO_API_KEY is missing. Human needs to set it in MCP config." };
    }
    const url = `${API_BASE_URL.replace(/\/$/, '')}${endpoint}`;
    try {
        const res = await fetch(url, {
            method,
            headers: {
                "Authorization": `Bearer ${PASSPORT_KEY}`,
                "Content-Type": "application/json",
            },
            body: body ? JSON.stringify(body) : null,
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            console.error(`[API ERROR] ${endpoint}:`, err.error);
            return { error: "API_ERROR", message: err.error || res.statusText };
        }

        return await res.json();
    } catch (err: any) {
        console.error(`[NETWORK ERROR] ${endpoint}:`, err.message);
        return { error: "NETWORK_ERROR", message: err.message };
    }
}

// Internal API calls that require INTERNAL_SECRET (resolve PAN, burn token)
async function internalApiRequest(endpoint: string, method: string, body: any) {
    if (!INTERNAL_SECRET) {
        console.error("[MCP] Z_ZERO_INTERNAL_SECRET is missing — cannot call secure endpoints");
        return { error: "CONFIG_ERROR", message: "INTERNAL_SECRET not configured" };
    }
    const url = `${API_BASE_URL.replace(/\/$/, '')}${endpoint}`;
    try {
        const res = await fetch(url, {
            method,
            headers: {
                "x-internal-secret": INTERNAL_SECRET,
                "Content-Type": "application/json",
            },
            body: body ? JSON.stringify(body) : null,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            console.error(`[INTERNAL API ERROR] ${endpoint}:`, err.error);
            return { error: "API_ERROR", message: err.error || res.statusText };
        }
        return await res.json();
    } catch (err: any) {
        console.error(`[NETWORK ERROR] ${endpoint}:`, err.message);
        return { error: "NETWORK_ERROR", message: err.message };
    }
}

export async function listCardsRemote(): Promise<any> {
    return await apiRequest('/api/tokens/cards', 'GET');
}

export async function getBalanceRemote(cardAlias: string): Promise<any> {
    const data = await listCardsRemote();
    if (data?.error) return data;
    const cards = data?.cards || [];
    const card = cards.find((c: any) => c.alias === cardAlias);
    if (!card) return null;
    return {
        wallet_balance: card.balance,
        currency: card.currency,
        note: "This is the total wallet balance (human-level). Cards have 'limits' set at creation, not 'balances'. Use list_cards to see active token limits."
    };
}

export async function getDepositAddressesRemote(): Promise<any> {
    return await apiRequest('/api/tokens/cards', 'GET');
}

export async function issueTokenRemote(
    cardAlias: string,
    amount: number,
    merchant: string
): Promise<any | null> {
    const data = await apiRequest('/api/tokens/issue', 'POST', {
        card_alias: cardAlias,
        amount,
        merchant,
        device_fingerprint: `mcp-host-${process.platform}-${process.arch}`,
        network_id: process.env.NETWORK_ID || "unknown-local-net",
        session_id: `sid-${Math.random().toString(36).substring(7)}`
    });

    if (!data) return null;

    // Forward API errors (402 insufficient, 429 max cards, etc.)
    if (data.error) return data;

    // Adapt Dashboard API response to MCP expected format
    return {
        token: data.token,
        card_alias: cardAlias,
        amount: amount,
        merchant: merchant,
        created_at: Date.now(),
        ttl_seconds: 1800,
        used: false
    };
}

export async function resolveTokenRemote(token: string): Promise<CardData | null> {
    // Uses INTERNAL_SECRET — this endpoint returns real PAN/CVV
    const data = await internalApiRequest('/api/tokens/resolve', 'POST', { token });
    if (!data || data.error) return data;

    return {
        number: data.number,
        exp_month: data.exp?.split('/')[0] || "12",
        exp_year: "20" + (data.exp?.split('/')[1] || "30"),
        cvv: data.cvv || "123",
        name: data.name || "Z-ZERO AI AGENT"
    };
}

export async function burnTokenRemote(token: string, receipt_id?: string): Promise<boolean> {
    // Uses INTERNAL_SECRET — burn endpoint requires it
    const data = await internalApiRequest('/api/tokens/burn', 'POST', {
        token,
        receipt_id,
        success: true
    });
    return !!data && !data.error;
}

export async function cancelTokenRemote(token: string): Promise<any> {
    const data = await apiRequest('/api/tokens/cancel', 'POST', { token });
    if (data?.error) return data;
    return {
        success: !!data,
        refunded_amount: data?.refunded_amount || 0
    };
}

export async function refundUnderspendRemote(token: string, actualSpent: number): Promise<void> {
    // Underspend is a complex feature that usually happens at the bank level, 
    // but for JIT tokens, the burn tool in the dashboard could handle this in the future.
    // Currently we burn the full authorized amount.
    console.log(`[MCP] Burned token ${token} after spending $${actualSpent}`);
}
