// Z-ZERO Unified API Backend
// Connects to the Dashboard Next.js API for all card and token operations.
// This preserves the "Issuer Abstraction Layer" - the bot never sees direct DB or Banking keys.

import type { CardData, PaymentToken } from "./types.js";

const API_BASE_URL = process.env.Z_ZERO_API_BASE_URL || "https://clawcard.store";
const PASSPORT_KEY = process.env.Z_ZERO_API_KEY || "";

if (!PASSPORT_KEY) {
    console.error("❌ Missing Z_ZERO_API_KEY (Your Passport) in environment variables.");
}

async function apiRequest(endpoint: string, method: string = 'GET', body: any = null) {
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
            return null;
        }

        return await res.json();
    } catch (err: any) {
        console.error(`[NETWORK ERROR] ${endpoint}:`, err.message);
        return null;
    }
}

export async function listCardsRemote(): Promise<Array<{ alias: string; balance: number; currency: string }>> {
    const data = await apiRequest('/api/tokens/cards', 'GET');
    return data?.cards || [];
}

export async function getBalanceRemote(cardAlias: string): Promise<{ balance: number; currency: string } | null> {
    const cards = await listCardsRemote();
    const card = cards.find(c => c.alias === cardAlias);
    if (!card) return null;
    return { balance: card.balance, currency: card.currency };
}

export async function getDepositAddressesRemote(): Promise<{ evm: string; tron: string } | null> {
    const data = await apiRequest('/api/tokens/cards', 'GET');
    return data?.deposit_addresses || null;
}

export async function issueTokenRemote(
    cardAlias: string,
    amount: number,
    merchant: string
): Promise<any | null> {
    const data = await apiRequest('/api/tokens/issue', 'POST', {
        card_alias: cardAlias,
        amount,
        merchant
    });

    if (!data) return null;

    // Adapt Dashboard API response to MCP expected format
    return {
        token: data.token,
        card_alias: cardAlias,
        amount: amount,
        merchant: merchant,
        created_at: Date.now(),
        ttl_seconds: 1800, // Matching Dashboard TTL
        used: false
    };
}

export async function resolveTokenRemote(token: string): Promise<CardData | null> {
    const data = await apiRequest('/api/tokens/resolve', 'POST', { token });
    if (!data) return null;

    return {
        number: data.number,
        exp_month: data.exp?.split('/')[0] || "12",
        exp_year: "20" + (data.exp?.split('/')[1] || "30"),
        cvv: data.cvv || "123",
        name: data.name || "Z-ZERO AI AGENT"
    };
}

export async function burnTokenRemote(token: string, receipt_id?: string): Promise<boolean> {
    const data = await apiRequest('/api/tokens/burn', 'POST', {
        token,
        receipt_id,
        success: true
    });
    return !!data;
}

export async function cancelTokenRemote(token: string): Promise<{ success: boolean; refunded_amount: number }> {
    const data = await apiRequest('/api/tokens/cancel', 'POST', { token });
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
