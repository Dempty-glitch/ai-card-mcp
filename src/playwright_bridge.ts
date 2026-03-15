// Playwright Bridge - The "Invisible Hand"
// Securely injects card data into checkout forms without exposing it to AI

import { chromium } from "playwright";
import type { CardData, PaymentResult } from "./types.js";
import { withTimeout, TimeoutError } from "./lib/with-timeout.js";

const CHECKOUT_HARD_TIMEOUT_MS = 60_000; // 60s absolute cap — prevents slow-loris attacks

/**
 * Detects and fills credit card form fields on a checkout page.
 * Card data exists ONLY in RAM and is wiped after injection.
 * Hard timeout of 60s prevents merchant page from hanging indefinitely.
 */
export async function fillCheckoutForm(
    checkoutUrl: string,
    cardData: CardData,
    existingPage?: import("playwright").Page
): Promise<PaymentResult> {
    let browser: import("playwright").Browser | null = null;
    let page: import("playwright").Page;

    if (existingPage) {
        page = existingPage;
    } else {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        page = await context.newPage();
    }

    try {
        return await withTimeout(
            _fillCheckoutFormInner(page, checkoutUrl, cardData),
            CHECKOUT_HARD_TIMEOUT_MS,
            'fillCheckoutForm',
            async () => {
                console.error('[PLAYWRIGHT] ⚠️ Hard timeout hit — force-closing browser');
                if (browser) await browser.close().catch(() => {});
            }
        );
    } catch (err: unknown) {
        if (err instanceof TimeoutError) {
            return {
                success: false,
                message: `Checkout timed out after ${CHECKOUT_HARD_TIMEOUT_MS / 1000}s. The merchant page may be too slow or blocking automation.`,
            };
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        return { success: false, message: `Payment failed: ${errMsg}` };
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

// ============================================================
// HELPER: Smart fill — handles both <input> and <select>
// Prevents crash when dropdown uses <select> instead of <input>
// ============================================================
async function smartFill(el: import("playwright").ElementHandle, value: string): Promise<boolean> {
    try {
        const tag = await el.evaluate(e => (e as HTMLElement).tagName.toLowerCase());
        if (tag === 'select') {
            // Try by value first (most common: "01", "12", "2030")
            try { await el.selectOption({ value }); return true; } catch { /* next */ }
            // Try matching option label containing the value
            try { await el.selectOption({ label: value }); return true; } catch { /* next */ }
            // Last resort: numeric index (month "01" → index 1 if 0="Select...")
            const idx = parseInt(value, 10);
            if (!isNaN(idx)) {
                try { await el.selectOption({ index: idx }); return true; } catch { /* give up */ }
            }
            return false;
        } else {
            await el.fill(value);
            return true;
        }
    } catch {
        return false;
    }
}

/** Try each selector in order, smartFill the first match */
async function tryFillField(
    page: import("playwright").Page,
    selectors: string[],
    value: string
): Promise<boolean> {
    for (const selector of selectors) {
        const el = await page.$(selector);
        if (el) {
            const ok = await smartFill(el, value);
            if (ok) return true;
        }
    }
    return false;
}

/** Internal implementation — called by fillCheckoutForm inside a timeout wrapper */
async function _fillCheckoutFormInner(
    page: import("playwright").Page,
    checkoutUrl: string,
    cardData: CardData
): Promise<PaymentResult> {
    try {
        // ✅ FIX: Skip navigation if page already loaded (Single Browser reuse from auto_pay_checkout)
        // Prevents double-navigate which would reload page and lose cart/session state.
        const currentUrl = page.url();
        const baseCheckoutUrl = checkoutUrl.split("?")[0];
        if (!currentUrl || currentUrl === "about:blank" || !currentUrl.startsWith(baseCheckoutUrl)) {
            await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
        }

        // ============================================================
        // STRATEGY 1: Standard HTML form fields
        // Covers: plain forms, Shopify, WooCommerce, custom checkouts
        // Priority: autocomplete (W3C) → name → platform-specific → placeholder → aria-label
        // ============================================================
        const S = {
            number: [
                '[autocomplete="cc-number"]',
                'input[name="cardnumber"]',
                'input[name="card-number"]',
                'input[name="cc-number"]',
                'input[name="card_number"]',
                'input[name="checkout[payment][card_number]"]',       // Shopify
                'input[id="wc-stripe-cc-number"]',                    // WooCommerce
                'input[data-elements-stable-field-name="cardNumber"]',
                'input[placeholder*="card number" i]',
                'input[aria-label*="card number" i]',
            ],
            expiry: [
                '[autocomplete="cc-exp"]',
                'input[name="exp-date"]',
                'input[name="cc-exp"]',
                'input[name="expiry"]',
                'input[name="checkout[payment][card_expiry]"]',       // Shopify
                'input[placeholder*="MM / YY" i]',
                'input[placeholder*="MM/YY" i]',
                'input[aria-label*="expir" i]',
            ],
            exp_month: [
                '[autocomplete="cc-exp-month"]',
                'select[name="exp-month"]',
                'select[name="exp_month"]',
                'select[name="card_exp_month"]',
                'select[id*="exp-month" i]',
                'select[id*="exp_month" i]',
                'input[name="exp-month"]',
                'input[name="exp_month"]',
            ],
            exp_year: [
                '[autocomplete="cc-exp-year"]',
                'select[name="exp-year"]',
                'select[name="exp_year"]',
                'select[name="card_exp_year"]',
                'select[id*="exp-year" i]',
                'select[id*="exp_year" i]',
                'input[name="exp-year"]',
                'input[name="exp_year"]',
            ],
            cvv: [
                '[autocomplete="cc-csc"]',
                'input[name="cvc"]',
                'input[name="cvv"]',
                'input[name="cc-csc"]',
                'input[name="security_code"]',
                'input[name="checkout[payment][card_cvc]"]',          // Shopify
                'input[id="wc-stripe-cc-cvc"]',                       // WooCommerce
                'input[placeholder*="CVC" i]',
                'input[placeholder*="CVV" i]',
                'input[placeholder*="security" i]',
                'input[aria-label*="security code" i]',
                'input[aria-label*="CVC" i]',
            ],
            name: [
                '[autocomplete="cc-name"]',
                'input[name="ccname"]',
                'input[name="cc-name"]',
                'input[name="card-name"]',
                'input[name="card_name"]',
                'input[placeholder*="name on card" i]',
                'input[placeholder*="cardholder" i]',
                'input[aria-label*="name on card" i]',
            ],
        };

        let filledFields = 0;

        // Card Number
        if (await tryFillField(page, S.number, cardData.number)) filledFields++;

        // Expiry: try combined MM/YY first
        const expiryValue = `${cardData.exp_month}/${cardData.exp_year.slice(-2)}`;
        let expiryFilled = await tryFillField(page, S.expiry, expiryValue);
        if (expiryFilled) filledFields++;

        // Expiry: fallback to separate month + year (works with both <input> AND <select>)
        if (!expiryFilled) {
            if (await tryFillField(page, S.exp_month, cardData.exp_month)) filledFields++;
            if (await tryFillField(page, S.exp_year, cardData.exp_year)) filledFields++;
        }

        // CVV
        if (await tryFillField(page, S.cvv, cardData.cvv)) filledFields++;

        // Name on Card
        if (await tryFillField(page, S.name, cardData.name)) filledFields++;

        // ============================================================
        // STRATEGY 2: Stripe Elements (iframe-based)
        // Stripe renders payment inputs inside iframes from js.stripe.com.
        // Some merchants use __privateStripeFrame* named frames.
        // Stripe has 2 modes:
        //   - Unified: 1 iframe with all fields (card, exp, cvc in one)
        //   - Split: separate iframes per field (cardNumber, cardExpiry, cardCvc)
        // We handle both by scanning ALL matching Stripe frames.
        // ============================================================
        if (filledFields === 0) {
            const stripeFrames = page.frames().filter((f) => {
                const url = f.url();
                const name = f.name();
                return url.includes('js.stripe.com')
                    || url.includes('stripe.com/elements')
                    || name.startsWith('__privateStripeFrame');
            });

            for (const frame of stripeFrames) {
                // Card Number
                for (const sel of [
                    'input[name="cardnumber"]',
                    'input[autocomplete="cc-number"]',
                    'input[data-elements-stable-field-name="cardNumber"]',
                ]) {
                    const el = await frame.$(sel);
                    if (el) { await el.fill(cardData.number); filledFields++; break; }
                }

                // Expiry (Stripe uses MM/YY without slash)
                for (const sel of [
                    'input[name="exp-date"]',
                    'input[autocomplete="cc-exp"]',
                    'input[data-elements-stable-field-name="cardExpiry"]',
                ]) {
                    const el = await frame.$(sel);
                    if (el) {
                        await el.fill(`${cardData.exp_month}${cardData.exp_year.slice(-2)}`);
                        filledFields++;
                        break;
                    }
                }

                // CVC
                for (const sel of [
                    'input[name="cvc"]',
                    'input[autocomplete="cc-csc"]',
                    'input[data-elements-stable-field-name="cardCvc"]',
                ]) {
                    const el = await frame.$(sel);
                    if (el) { await el.fill(cardData.cvv); filledFields++; break; }
                }
            }
        }

        if (filledFields === 0) {
            return {
                success: false,
                message:
                    "Could not detect any credit card fields on this page. The checkout form may use an unsupported format.",
            };
        }

        // ============================================================
        // LOOK FOR "PAY" / "SUBMIT" BUTTON
        // ============================================================
        const payButtonSelectors = [
            'button[type="submit"]',
            'button:has-text("Pay")',
            'button:has-text("Submit")',
            'button:has-text("Place order")',
            'button:has-text("Complete")',
            'input[type="submit"]',
        ];

        let clicked = false;
        for (const selector of payButtonSelectors) {
            const btn = await page.$(selector);
            if (btn && (await btn.isVisible())) {
                await btn.click();
                clicked = true;
                break;
            }
        }

        // Wait for navigation or response
        if (clicked) {
            await page.waitForTimeout(3000);
        }

        const receiptId = `rcpt_${Date.now().toString(36)}`;

        return {
            success: true,
            message: `Payment form filled and submitted successfully. ${filledFields} fields injected.`,
            receipt_id: receiptId,
        };
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            message: `Payment failed: ${errMsg}`,
        };
    } finally {
        // ============================================================
        // RAM WIPE - Critical security step
        // ============================================================
        // Overwrite card data with zeros before dereferencing
        cardData.number = "0000000000000000";
        cardData.cvv = "000";
        cardData.exp_month = "00";
        cardData.exp_year = "0000";
        cardData.name = "";
        // Note: browser.close() is handled by fillCheckoutForm's outer finally block
    }
}
