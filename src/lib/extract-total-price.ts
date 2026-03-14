// extract-total-price.ts
// Phase 2: Smart Routing - DOM Price Extractor
// Scans a checkout page via Playwright and returns the cart total in USD.
// Returns null if no price can be confidently found.

import type { Page } from "playwright";

/**
 * Multi-strategy total price extractor.
 * Strategy order (most reliable → least reliable):
 *   1. Known CSS selectors for major platforms (Shopify, Stripe, Woo)
 *   2. Aria / data-testid patterns
 *   3. Text heuristic: find largest $ amount near keywords "total", "amount due"
 */
export async function extractTotalPrice(page: Page): Promise<number | null> {
    // ─── Strategy 1: Well-known selector list ────────────────────────────────
    const knownSelectors = [
        // Shopify
        '[data-checkout-payment-amount]',
        '.payment-due__price',
        // Stripe Checkout
        '[data-testid="total-amount"]',
        '.OrderAmountRow--total .OrderAmountRow-amount',
        // Woocommerce
        '.order-total .amount',
        '.woocommerce-Price-amount.amount',
        // Generic
        '[data-testid*="total" i]',
        '[class*="order-total" i]',
        '[class*="total-price" i]',
        '[class*="grand-total" i]',
        '[id*="order-total" i]',
        '[id*="grand-total" i]',
        'span[class*="total"]',
        'td[class*="total"]',
    ];

    for (const selector of knownSelectors) {
        try {
            const el = await page.$(selector);
            if (!el) continue;
            const text = await el.innerText();
            const parsed = parseMoneyString(text);
            if (parsed !== null && parsed > 0) {
                console.error(`[PRICE] ✅ Strategy 1 found via selector "${selector}": $${parsed}`);
                return parsed;
            }
        } catch {
            // element may have been removed from DOM — continue
        }
    }

    // ─── Strategy 2: Scan all visible text near "total" keyword ──────────────
    try {
        const amount = await page.evaluate(() => {
            const allText = Array.from(document.querySelectorAll('*'))
                .filter((el): el is HTMLElement => {
                    if (!(el instanceof HTMLElement)) return false;
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden';
                })
                .filter(el => {
                    const text = el.innerText?.toLowerCase() ?? '';
                    return (
                        (text.includes('total') || text.includes('amount due') || text.includes('you pay')) &&
                        el.children.length < 5 // narrow to leaf-ish nodes
                    );
                })
                .map(el => el.innerText ?? '');

            // Find first valid $ pattern in those elements
            const priceRegex = /\$\s*([\d,]+(?:\.\d{1,2})?)/;
            for (const text of allText) {
                const match = text.match(priceRegex);
                if (match) {
                    const value = parseFloat(match[1].replace(/,/g, ''));
                    if (value > 0 && value < 10000) return value; // sanity bound
                }
            }
            return null;
        });

        if (amount !== null && amount > 0) {
            console.error(`[PRICE] ✅ Strategy 2 (text heuristic) found: $${amount}`);
            return amount;
        }
    } catch (e) {
        console.error(`[PRICE] Strategy 2 failed: ${e}`);
    }

    // ─── Strategy 3: Last resort — biggest dollar amount visible on page ─────
    try {
        const amount = await page.evaluate(() => {
            const regex = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;
            const bodyText = (document.body as HTMLElement).innerText ?? '';
            const values: number[] = [];
            let m: RegExpExecArray | null;
            while ((m = regex.exec(bodyText)) !== null) {
                const v = parseFloat(m[1].replace(/,/g, ''));
                if (v >= 0.5 && v < 10000) values.push(v);
            }
            if (values.length === 0) return null;
            return Math.max(...values);
        });

        if (amount !== null && amount > 0) {
            console.error(`[PRICE] ⚠️  Strategy 3 (largest $ on page): $${amount}. Low confidence.`);
            return amount;
        }
    } catch (e) {
        console.error(`[PRICE] Strategy 3 failed: ${e}`);
    }

    console.error('[PRICE] ❌ Could not detect total price on this page.');
    return null;
}

// ─── Utility ─────────────────────────────────────────────────────────────────
function parseMoneyString(text: string): number | null {
    // Handles: "$49.99", "USD 49.99", "49,99 $", "49.99 USD"
    const match = text.match(/[\d,]+(?:\.\d{1,2})?/);
    if (!match) return null;
    const value = parseFloat(match[0].replace(/,/g, ''));
    if (isNaN(value) || value <= 0) return null;
    return value;
}
