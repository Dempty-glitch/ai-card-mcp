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
}

export interface PaymentToken {
    token: string;
    card_alias: string;
    amount: number;
    merchant: string;
    created_at: number;   // Unix timestamp
    ttl_seconds: number;  // Time-to-live
    used: boolean;
}

export interface CardData {
    number: string;
    exp_month: string;
    exp_year: string;
    cvv: string;
    name: string;
}

export interface PaymentResult {
    success: boolean;
    message: string;
    receipt_id?: string;
    amount?: number;
}
