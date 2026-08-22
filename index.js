process.on("uncaughtException", (err) => {
    console.error("CRITICAL UNCATCHED EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
    console.error("CRITICAL UNHANDLED REJECTION:", reason);
});

const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

// File jisme numbers rakhe hain
const NUMBERS_FILE = path.join(__dirname, "number.txt");

// Delay helper function
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// =====================================================
// READ NUMBERS FROM FILE
// =====================================================
function getNumbersList() {
    if (!fs.existsSync(NUMBERS_FILE)) {
        console.error("ERROR: number.txt file nahi mili! Folder mein number.txt banayein.");
        process.exit(1);
    }
    const content = fs.readFileSync(NUMBERS_FILE, "utf-8");
    return content.split("\n").map(n => n.trim()).filter(n => n.length > 0);
}

// =====================================================
// MAIN AUTOMATION PROCESS
// =====================================================
async function processNumber(page, phoneNumber) {
    console.log(`\n--------------------------------------`);
    console.log(`LOG: Processing Number -> ${phoneNumber}`);
    console.log(`--------------------------------------`);

    const IDENTIFY_URL = "https://www.facebook.com/login/identify/";

    // 1. Open identify page
    await page.goto(IDENTIFY_URL, { waitUntil: "networkidle2", timeout: 40000 });
    await sleep(2000);

    // 2. Find Search Input & Type Number
    console.log("LOG: Searching input box...");
    const inputSelector = '#identify_email, input[name="email"], input[type="text"]';
    await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });
    
    // Clear & Type
    await page.click(inputSelector);
    await page.evaluate((sel) => { document.querySelector(sel).value = ""; }, inputSelector);
    await page.type(inputSelector, phoneNumber, { delay: 50 });

    console.log("LOG: Number entered. Submitting search via Enter key...");

    // 3. Submit Form using Enter Key
    await page.keyboard.press("Enter");

    await sleep(5000); // Response wait

    // 4. Check if Account Exists or Not Found
    const pageText = await page.evaluate(() => document.body.innerText);

    if (
        pageText.includes("No search results") || 
        pageText.includes("No account found") || 
        pageText.includes("Your search did not return any results") ||
        pageText.includes("We couldn't find an account")
    ) {
        console.log(`❌ RESULT: [${phoneNumber}] -> No Account Found.`);
        return; // Move to next number
    }

    console.log(`✅ RESULT: [${phoneNumber}] -> Account Found!`);

    // 5. Select "Get code via SMS" option if available
    try {
        console.log("LOG: Looking for SMS option...");
        await sleep(2000);

        await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input[type="radio"]'));
            for (let input of inputs) {
                if (input.value.includes('sms') || input.id.includes('sms')) {
                    input.click();
                    break;
                }
            }
        });

        // Submit to send code
        await page.keyboard.press("Enter");
        console.log("LOG: Submitted form to send code.");
        await sleep(5000);

        // 6. Click "Didn't get a code?"
        console.log("LOG: Looking for 'Did not get a code' option...");
        
        const didNotGetCodeClicked = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('a, button, span'));
            const target = elements.find(el => {
                const txt = el.innerText ? el.innerText.toLowerCase() : "";
                return txt.includes("didn't get a code") || 
                       txt.includes("didn't receive a code") ||
                       txt.includes("resend code");
            });
            if (target) {
                target.click();
                return true;
            }
            return false;
        });

        if (didNotGetCodeClicked) {
            console.log("LOG: Successfully clicked 'Didn't get a code'.");
        } else {
            console.log("LOG: 'Didn't get a code' link not found or page changed.");
        }

        await sleep(3000);

    } catch (err) {
        console.error("ERROR during recovery flow:", err.message);
    }
}

// =====================================================
// BOT RUNNER
// =====================================================
async function startBot() {
    const numbers = getNumbersList();
    console.log(`LOG: Total ${numbers.length} numbers loaded from file.`);

    if (numbers.length === 0) {
        console.log("LOG: number.txt is empty. Stopping bot.");
        return;
    }

    console.log("LOG: Launching Browser...");
    const browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-blink-features=AutomationControlled"
        ]
    });

    const page = await browser.newPage();

    // User Agent Set
    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1366, height: 768 });

    // Loop through each number
    for (let i = 0; i < numbers.length; i++) {
        try {
            await processNumber(page, numbers[i]);
        } catch (err) {
            console.error(`ERROR processing number ${numbers[i]}:`, err.message);
        }
        await sleep(3000); // Gap between attempts
    }

    console.log("\n======================================");
    console.log("LOG: All numbers processed! Closing browser.");
    console.log("======================================\n");

    await browser.close();
}

startBot();
