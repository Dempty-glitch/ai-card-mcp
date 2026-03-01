// Mock Neobank Backend - Simulates the card vault and token issuing system
// In production, this would be replaced by your real Neobank API

import crypto from "crypto";
import type { VirtualCard, PaymentToken, CardData } from "./types.js";

// ============================================================
// CARD VAULT (In-memory store - simulates encrypted database)
// ============================================================
const cardVault: Map<string, VirtualCard> = new Map([
    [
        "Card_01",
        {
            alias: "Card_01",
            number: "4242424242424242", // Stripe test card
            exp_month: "12",
            exp_year: "2030",
            cvv: "123",
            name: "AI Agent Card 01",
            balance: 50.0,
            currency: "USD",
        },
    ],
    [
        "Card_02",
        {
            alias: "Card_02",
            number: "5555555555554444", // Mastercard test
            exp_month: "06",
            exp_year: "2029",
            cvv: "456",
            name: "AI Agent Card 02",
            balance: 100.0,
            currency: "USD",
        },
    ],
]);

// ============================================================
// TOKEN STORE (Active JIT tokens)
// ============================================================
const tokenStore: Map<string, PaymentToken> = new Map();

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Issue a temporary payment token for a specific card and amount.
 * Token is valid for `ttlSeconds` (default: 900 = 15 minutes).
 */
export function issueToken(
    cardAlias: string,
    amount: number,
    merchant: string,
    ttlSeconds: number = 900
): PaymentToken | null {
    const card = cardVault.get(cardAlias);
    if (!card) {
        return null;
    }

    if (card.balance < amount) {
        return null;
    }

    const token: PaymentToken = {
        token: `temp_auth_${crypto.randomBytes(4).toString("hex")}`,
        card_alias: cardAlias,
        amount,
        merchant,
        created_at: Date.now(),
        ttl_seconds: ttlSeconds,
        used: false,
    };

    tokenStore.set(token.token, token);
    return token;
}

/**
 * Resolve a token to real card data. 
 * CRITICAL: The returned CardData object lives ONLY in RAM.
 * It must NEVER be logged, serialized, or returned to the AI.
 */
export function resolveToken(tokenId: string): CardData | null {
    const token = tokenStore.get(tokenId);
    if (!token) {
        return null; // Token doesn't exist
    }

    if (token.used) {
        return null; // Already burned
    }

    // Check TTL expiration
    const age = (Date.now() - token.created_at) / 1000;
    if (age > token.ttl_seconds) {
        tokenStore.delete(tokenId); // Expired, clean up
        return null;
    }

    const card = cardVault.get(token.card_alias);
    if (!card) {
        return null;
    }

    // Return card data (RAM only - never log this!)
    return {
        number: card.number,
        exp_month: card.exp_month,
        exp_year: card.exp_year,
        cvv: card.cvv,
        name: card.name,
    };
}

/**
 * Burn a token after use - makes it permanently invalid.
 * Also deducts the amount from the card balance.
 */
export function burnToken(tokenId: string): boolean {
    const token = tokenStore.get(tokenId);
    if (!token) return false;

    token.used = true;

    // Deduct balance
    const card = cardVault.get(token.card_alias);
    if (card) {
        card.balance -= token.amount;
    }

    // Schedule complete removal from memory
    setTimeout(() => {
        tokenStore.delete(tokenId);
    }, 5000);

    return true;
}

/**
 * Check balance of a card (safe to expose to AI).
 */
export function getBalance(
    cardAlias: string
): { balance: number; currency: string } | null {
    const card = cardVault.get(cardAlias);
    if (!card) return null;
    return { balance: card.balance, currency: card.currency };
}

/**
 * List available card aliases (safe to expose to AI - no sensitive data).
 */
export function listCards(): Array<{
    alias: string;
    balance: number;
    currency: string;
}> {
    const result: Array<{ alias: string; balance: number; currency: string }> =
        [];
    for (const card of cardVault.values()) {
        result.push({
            alias: card.alias,
            balance: card.balance,
            currency: card.currency,
        });
    }
    return result;
}
