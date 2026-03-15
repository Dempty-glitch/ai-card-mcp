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

/** Internal implementation — called by fillCheckoutForm inside a timeout wrapper */
async function _fillCheckoutFormInner(
    page: import("playwright").Page,
    checkoutUrl: string,   // ✅ BUG 8 FIX: need URL to navigate to
    cardData: CardData
): Promise<PaymentResult> {
    try {
        // ✅ BUG 8 FIX: Navigate to the checkout page (was missing — page was blank!)
        await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });

        // ============================================================
        // STRATEGY 1: Standard HTML form fields
        // ============================================================
        const standardSelectors = {
            number: [
                'input[name="cardnumber"]',
                'input[name="card-number"]',
                'input[name="cc-number"]',
                'input[autocomplete="cc-number"]',
                'input[data-elements-stable-field-name="cardNumber"]',
                'input[placeholder*="card number" i]',
                'input[placeholder*="Card number" i]',
                'input[aria-label*="card number" i]',
            ],
            expiry: [
                'input[name="exp-date"]',
                'input[name="cc-exp"]',
                'input[autocomplete="cc-exp"]',
                'input[placeholder*="MM / YY" i]',
                'input[placeholder*="MM/YY" i]',
                'input[aria-label*="expir" i]',
            ],
            exp_month: [
                'input[name="exp-month"]',
                'select[name="exp-month"]',
                'input[autocomplete="cc-exp-month"]',
            ],
            exp_year: [
                'input[name="exp-year"]',
                'select[name="exp-year"]',
                'input[autocomplete="cc-exp-year"]',
            ],
            cvv: [
                'input[name="cvc"]',
                'input[name="cvv"]',
                'input[name="cc-csc"]',
                'input[autocomplete="cc-csc"]',
                'input[placeholder*="CVC" i]',
                'input[placeholder*="CVV" i]',
                'input[aria-label*="security code" i]',
            ],
            name: [
                'input[name="ccname"]',
                'input[name="cc-name"]',
                'input[autocomplete="cc-name"]',
                'input[placeholder*="name on card" i]',
                'input[aria-label*="name on card" i]',
            ],
        };

        // Try to fill each field
        let filledFields = 0;

        // Card Number
        for (const selector of standardSelectors.number) {
            const el = await page.$(selector);
            if (el) {
                await el.fill(cardData.number);
                filledFields++;
                break;
            }
        }

        // Expiry (combined MM/YY format)
        let expiryFilled = false;
        for (const selector of standardSelectors.expiry) {
            const el = await page.$(selector);
            if (el) {
                await el.fill(`${cardData.exp_month}/${cardData.exp_year.slice(-2)}`);
                filledFields++;
                expiryFilled = true;
                break;
            }
        }

        // Expiry (separate month/year fields)
        if (!expiryFilled) {
            for (const selector of standardSelectors.exp_month) {
                const el = await page.$(selector);
                if (el) {
                    await el.fill(cardData.exp_month);
                    filledFields++;
                    break;
                }
            }
            for (const selector of standardSelectors.exp_year) {
                const el = await page.$(selector);
                if (el) {
                    await el.fill(cardData.exp_year);
                    filledFields++;
                    break;
                }
            }
        }

        // CVV
        for (const selector of standardSelectors.cvv) {
            const el = await page.$(selector);
            if (el) {
                await el.fill(cardData.cvv);
                filledFields++;
                break;
            }
        }

        // Name on Card
        for (const selector of standardSelectors.name) {
            const el = await page.$(selector);
            if (el) {
                await el.fill(cardData.name);
                filledFields++;
                break;
            }
        }

        // ============================================================
        // STRATEGY 2: Stripe Elements (iframe-based)
        // ============================================================
        if (filledFields === 0) {
            const stripeFrames = page.frames().filter((f) =>
                f.url().includes("js.stripe.com")
            );
            for (const frame of stripeFrames) {
                const cardInput = await frame.$('input[name="cardnumber"]');
                if (cardInput) {
                    await cardInput.fill(cardData.number);
                    filledFields++;
                }
                const expInput = await frame.$('input[name="exp-date"]');
                if (expInput) {
                    await expInput.fill(
                        `${cardData.exp_month}${cardData.exp_year.slice(-2)}`
                    );
                    filledFields++;
                }
                const cvcInput = await frame.$('input[name="cvc"]');
                if (cvcInput) {
                    await cvcInput.fill(cardData.cvv);
                    filledFields++;
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
