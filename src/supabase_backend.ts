// Z-ZERO Supabase Backend v2
// Connects to real Supabase DB + Airwallex Issuing API for real JIT Mastercards
// Card data is looked up via Z_ZERO_API_KEY, cards are issued via Airwallex

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import type { CardData, PaymentToken } from "./types.js";

// ============================================================
// SUPABASE CLIENT
// ============================================================
const SUPABASE_URL = process.env.Z_ZERO_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.Z_ZERO_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const API_KEY = process.env.Z_ZERO_API_KEY || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("❌ Missing Z_ZERO_SUPABASE_URL or Z_ZERO_SUPABASE_ANON_KEY env vars");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// AIRWALLEX CONFIG
// ============================================================
const AIRWALLEX_API_KEY = process.env.Z_ZERO_AIRWALLEX_API_KEY || "";
const AIRWALLEX_CLIENT_ID = process.env.Z_ZERO_AIRWALLEX_CLIENT_ID || "";
const AIRWALLEX_ENV = process.env.Z_ZERO_AIRWALLEX_ENV || "demo";
const AIRWALLEX_BASE = AIRWALLEX_ENV === "prod"
    ? "https://api.airwallex.com/api/v1"
    : "https://api-demo.airwallex.com/api/v1";

// Cached auth token for Airwallex (avoids re-login per call)
let airwallexToken: string | null = null;
let airwallexTokenExpiry = 0;

async function getAirwallexToken(): Promise<string | null> {
    if (!AIRWALLEX_API_KEY || !AIRWALLEX_CLIENT_ID) return null;
    if (airwallexToken && Date.now() < airwallexTokenExpiry) return airwallexToken;

    try {
        const res = await fetch(`${AIRWALLEX_BASE}/authentication/login`, {
            method: "POST",
            headers: {
                "x-api-key": AIRWALLEX_API_KEY,
                "x-client-id": AIRWALLEX_CLIENT_ID,
                "Content-Type": "application/json",
            },
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        airwallexToken = data.token;
        airwallexTokenExpiry = Date.now() + 25 * 60 * 1000; // 25 min cache
        return airwallexToken;
    } catch (err) {
        console.error("[AIRWALLEX] Auth failed:", err);
        return null;
    }
}

// ============================================================
// IN-MEMORY TOKEN STORE
// Token structure now also holds the Airwallex card_id for cancellation
// ============================================================
interface ExtendedToken extends PaymentToken {
    airwallex_card_id?: string; // set only after real card is issued
    cancelled?: boolean;
}
const tokenStore: Map<string, ExtendedToken> = new Map();

// ============================================================
// RESOLVE API KEY → USER INFO
// ============================================================
async function resolveApiKey(): Promise<{ userId: string; walletBalance: number; cardId: string; cardAlias: string } | null> {
    if (!API_KEY) return null;

    const { data: card, error } = await supabase
        .from("cards")
        .select("id, alias, user_id, allocated_limit_usd, is_active")
        .eq("card_number_encrypted", API_KEY)
        .eq("is_active", true)
        .single();

    if (error || !card) {
        console.error("API Key not found:", error?.message);
        return null;
    }

    const { data: wallet } = await supabase
        .from("wallets")
        .select("balance")
        .eq("user_id", card.user_id)
        .single();

    return {
        userId: card.user_id,
        walletBalance: Number(wallet?.balance || 0),
        cardId: card.id,
        cardAlias: card.alias,
    };
}

// ============================================================
// PUBLIC API
// ============================================================

export async function listCardsRemote(): Promise<Array<{ alias: string; balance: number; currency: string }>> {
    const info = await resolveApiKey();
    if (!info) return [];
    return [{ alias: info.cardAlias, balance: info.walletBalance, currency: "USD" }];
}

export async function getBalanceRemote(cardAlias: string): Promise<{ balance: number; currency: string } | null> {
    const info = await resolveApiKey();
    if (!info || info.cardAlias !== cardAlias) return null;
    return { balance: info.walletBalance, currency: "USD" };
}

export async function getDepositAddressesRemote(): Promise<{ evm: string; tron: string } | null> {
    const info = await resolveApiKey();
    if (!info) return null;

    const { data: wallet, error } = await supabase
        .from("deposit_wallets")
        .select("evm_address, tron_address")
        .eq("user_id", info.userId)
        .single();

    if (error || !wallet) {
        console.error("Deposit wallets not found for user:", info.userId);
        return null;
    }

    return {
        evm: wallet.evm_address,
        tron: wallet.tron_address,
    };
}

export async function issueTokenRemote(
    cardAlias: string,
    amount: number,
    merchant: string,
    ttlSeconds: number = 1800 // 30 minutes default
): Promise<ExtendedToken | null> {
    // 1. Validate business rules
    if (amount < 1) {
        console.error("[ISSUE] Card amount must be at least $1.00");
        return null;
    }
    if (amount > 100) {
        console.error("[ISSUE] Card amount exceeds $100 maximum limit");
        return null;
    }

    // 2. Resolve user from API key
    const info = await resolveApiKey();
    if (!info) return null;
    if (info.cardAlias !== cardAlias) return null;
    if (info.walletBalance < amount) {
        console.error(`[ISSUE] Insufficient balance: $${info.walletBalance} < $${amount}`);
        return null;
    }

    const tokenId = `z_jit_${crypto.randomBytes(8).toString("hex")}`;

    // 3. Try to create a REAL Airwallex card
    let airwallexCardId: string | undefined;
    const airwallexAuth = await getAirwallexToken();

    if (airwallexAuth) {
        try {
            const expiryTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            const payload = {
                request_id: tokenId,
                issue_to: "ORGANISATION",
                name_on_card: "Z-ZERO AI AGENT",
                form_factor: "VIRTUAL",
                primary_currency: "USD",
                valid_to: expiryTime,
                authorization_controls: {
                    allowed_transaction_count: "SINGLE",
                    transaction_limits: {
                        currency: "USD",
                        limits: [{ amount, interval: "ALL_TIME" }],
                    },
                },
            };

            const res = await fetch(`${AIRWALLEX_BASE}/issuing/cards/create`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${airwallexAuth}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                const data = await res.json();
                airwallexCardId = data.card_id;
                console.error(`[AIRWALLEX] ✅ Real card issued: ${data.card_id} for $${amount}`);
            } else {
                const errText = await res.text();
                console.error("[AIRWALLEX] Card creation failed:", errText);
                // Fall through — will still create token but without real card ID
            }
        } catch (err) {
            console.error("[AIRWALLEX] Error creating card:", err);
        }
    } else {
        console.error("[AIRWALLEX] No auth token — running in mock mode");
    }

    const token: ExtendedToken = {
        token: tokenId,
        card_alias: cardAlias,
        amount,
        merchant,
        created_at: Date.now(),
        ttl_seconds: ttlSeconds,
        used: false,
        cancelled: false,
        airwallex_card_id: airwallexCardId,
    };

    tokenStore.set(tokenId, token);

    // 4. Pre-hold the amount in Supabase (deduct immediately, refund on cancel or underspend)
    const newBalance = info.walletBalance - amount;
    await supabase
        .from("wallets")
        .update({ balance: newBalance })
        .eq("user_id", info.userId);

    console.error(`[ISSUE] Token ${tokenId} created. Balance: $${info.walletBalance} → $${newBalance}`);
    return token;
}

export async function resolveTokenRemote(tokenId: string): Promise<CardData | null> {
    const token = tokenStore.get(tokenId);
    if (!token || token.used || token.cancelled) return null;

    const age = (Date.now() - token.created_at) / 1000;
    if (age > token.ttl_seconds) {
        tokenStore.delete(tokenId);
        return null;
    }

    // Try to fetch REAL card details from Airwallex
    if (token.airwallex_card_id) {
        const airwallexAuth = await getAirwallexToken();
        if (airwallexAuth) {
            try {
                const res = await fetch(`${AIRWALLEX_BASE}/issuing/cards/${token.airwallex_card_id}`, {
                    headers: { Authorization: `Bearer ${airwallexAuth}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    console.error("[AIRWALLEX] ✅ Real card details fetched.");
                    return {
                        number: data.card_number || "4242424242424242",
                        exp_month: data.expiry_month || "12",
                        exp_year: data.expiry_year || "2030",
                        cvv: data.cvv || "123",
                        name: data.name_on_card || "Z-ZERO AI AGENT",
                    };
                }
            } catch (err) {
                console.error("[AIRWALLEX] Failed to fetch card details:", err);
            }
        }
    }

    // Fallback to Stripe test card (demo/sandbox mode)
    console.error("[AIRWALLEX] ⚠️ Using test card fallback (4242...)");
    return {
        number: "4242424242424242",
        exp_month: "12",
        exp_year: "2030",
        cvv: "123",
        name: "Z-ZERO Agent",
    };
}

export async function cancelTokenRemote(tokenId: string): Promise<{ success: boolean; refunded_amount: number }> {
    const token = tokenStore.get(tokenId);
    if (!token || token.used || token.cancelled) {
        return { success: false, refunded_amount: 0 };
    }

    // Mark token as cancelled in memory
    token.cancelled = true;

    // Cancel the Airwallex card (if one was issued)
    if (token.airwallex_card_id) {
        const airwallexAuth = await getAirwallexToken();
        if (airwallexAuth) {
            try {
                await fetch(`${AIRWALLEX_BASE}/issuing/cards/${token.airwallex_card_id}/deactivate`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${airwallexAuth}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ cancellation_reason: "CANCELLED_BY_USER" }),
                });
                console.error(`[AIRWALLEX] Card ${token.airwallex_card_id} cancelled.`);
            } catch (err) {
                console.error("[AIRWALLEX] Failed to cancel card:", err);
            }
        }
    }

    // Refund the held amount back to wallet
    const info = await resolveApiKey();
    if (info) {
        const currentBalanceRes = await supabase
            .from("wallets")
            .select("balance")
            .eq("user_id", info.userId)
            .single();
        const currentBalance = Number(currentBalanceRes.data?.balance || 0);
        await supabase
            .from("wallets")
            .update({ balance: currentBalance + token.amount })
            .eq("user_id", info.userId);
        console.error(`[CANCEL] Refunded $${token.amount}. New balance: $${currentBalance + token.amount}`);
    }

    setTimeout(() => tokenStore.delete(tokenId), 5000);
    return { success: true, refunded_amount: token.amount };
}

export async function burnTokenRemote(tokenId: string): Promise<boolean> {
    const token = tokenStore.get(tokenId);
    if (!token || token.cancelled) return false;

    token.used = true;

    // Log the transaction — NOTE: wallet was already debited at issue time
    const info = await resolveApiKey();
    if (info) {
        await supabase.from("transactions").insert({
            card_id: info.cardId,
            amount: token.amount,
            merchant: token.merchant,
            status: "SUCCESS",
        });
    }

    setTimeout(() => tokenStore.delete(tokenId), 5000);
    return true;
}

// Handle underspend: called when transaction amount < token amount
export async function refundUnderspendRemote(tokenId: string, actualSpent: number): Promise<void> {
    const token = tokenStore.get(tokenId);
    if (!token) return;

    const overheld = token.amount - actualSpent;
    if (overheld <= 0) return;

    const info = await resolveApiKey();
    if (!info) return;

    const currentBalanceRes = await supabase
        .from("wallets")
        .select("balance")
        .eq("user_id", info.userId)
        .single();
    const currentBalance = Number(currentBalanceRes.data?.balance || 0);

    await supabase
        .from("wallets")
        .update({ balance: currentBalance + overheld })
        .eq("user_id", info.userId);

    console.error(`[REFUND] Underspend refunded: $${overheld} (Spent $${actualSpent} of $${token.amount})`);
}
