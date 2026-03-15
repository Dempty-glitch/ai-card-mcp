// Shared TypeScript types for AI Virtual Card MCP Server

export interface VirtualCard {
    alias: string;
    number: string;       // 16-digit card number
    exp_month: string;
    exp_year: string;
    cvv: string;
    name: string;
    balance: number;      // remaining balance in USD
    currency: string;
    error?: string;
    message?: string;
}

export interface PaymentToken {
    token: string;
    card_alias: string;
    amount: number;
    merchant: string;
    created_at: number;   // Unix timestamp
    ttl_seconds: number;  // Time-to-live
    used: boolean;
    error?: string;
    message?: string;
}

export interface CardData {
    number: string;
    exp_month: string;
    exp_year: string;
    cvv: string;
    name: string;
    authorized_amount?: number;  // Amount authorized when token was issued (for pre-flight guard)
    error?: string;
    message?: string;
}

export interface PaymentResult {
    success: boolean;
    message: string;
    receipt_id?: string;
    amount?: number;
}

export interface CheckoutHints {
    pre_steps?: string[];          // CSS selectors to click BEFORE filling (e.g. open payment accordion)
    card_selector?: string;        // CSS for card number input
    exp_selector?: string;         // CSS for expiry combined (MM/YY)
    exp_month_selector?: string;   // CSS for expiry month (if split)
    exp_year_selector?: string;    // CSS for expiry year (if split)
    cvv_selector?: string;         // CSS for CVV/CVC field
    name_selector?: string;        // CSS for cardholder name
    submit_selector?: string;      // CSS for submit/pay button
    notes?: string;                // Human-readable notes (logged, not used by PW)
}

