import { chromium } from 'playwright';
import { detectWeb3Payment } from '../src/lib/web3-detector';

async function testLink(url: string) {
    console.log(`\n[TEST] Scanning: ${url}`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
        const result = await detectWeb3Payment(page, url);
        console.log("[RESULT]", JSON.stringify(result, null, 2));
    } catch (e: any) {
        console.error("[ERROR]", e.message);
    } finally {
        await browser.close();
    }
}

const url = "https://moonpay.hel.io/deposit/0897d7b8-c781-46c2-a949-e09ca26b560e";
testLink(url).catch(console.error);
