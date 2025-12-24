import { Actor } from 'apify';
import { PlaywrightCrawler, ProxyConfiguration } from 'crawlee';

/**
 * Southwest Airlines Auto Check-In Actor
 * 
 * Input:
 * {
 *   "confirmationNumber": "ABC123",
 *   "firstName": "JOHN",
 *   "lastName": "DOE"
 * }
 * 
 * Output:
 * {
 *   "success": true,
 *   "boardingPosition": "A24",
 *   "confirmationNumber": "ABC123",
 *   "timestamp": "2025-12-24T12:00:00Z",
 *   "error": null
 * }
 */

await Actor.init();

try {
    // Get input from Apify
    const input = await Actor.getInput();
    
    if (!input) {
        throw new Error('No input provided');
    }

    const { confirmationNumber, firstName, lastName } = input;

    // Validate inputs
    if (!confirmationNumber || !firstName || !lastName) {
        throw new Error('Missing required fields: confirmationNumber, firstName, lastName');
    }

    console.log('Starting Southwest check-in for:', {
        confirmationNumber,
        firstName,
        lastName,
    });

    // Setup result object
    const result = {
        success: false,
        boardingPosition: null,
        confirmationNumber,
        timestamp: new Date().toISOString(),
        error: null,
        screenshots: [],
    };

    // Configure RESIDENTIAL proxy - CRITICAL for bypassing Southwest's blocking
    // Apify's datacenter IPs are blocked, so we MUST use residential proxies
    const proxyConfiguration = await Actor.createProxyConfiguration({
        groups: ['RESIDENTIAL'],
        countryCode: 'US',
    });

    // Create crawler
    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        requestHandlerTimeoutSecs: 120, // Increased from default 60s to handle slow Southwest pages
        launchContext: {
            launchOptions: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-web-security',
                ],
            },
        },
        preNavigationHooks: [
            async ({ page }, goToOptions) => {
                // Set realistic viewport
                await page.setViewportSize({ width: 1920, height: 1080 });
                
                // Set user agent
                await page.setExtraHTTPHeaders({
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                });
            },
        ],
        requestHandler: async ({ page, request }) => {
            console.log(`Processing ${request.url}`);

            try {
                // Step 1: Navigate to check-in page
                console.log('Navigating to check-in page...');
                await page.goto('https://www.southwest.com/air/check-in/index.html', {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000,
                });

                // Give page time to initialize
                await page.waitForTimeout(2000);

                // Take screenshot of initial page
                const screenshotInitial = await page.screenshot({ fullPage: false });
                await Actor.setValue('screenshot-initial', screenshotInitial, { contentType: 'image/png' });
                result.screenshots.push('screenshot-initial');
                console.log('Initial page loaded');

                // Wait for form to be visible
                console.log('Waiting for check-in form...');
                await page.waitForSelector('form, #form-mixin--air-check-in-form, input[name="confirmationNumber"]', { 
                    timeout: 10000,
                    state: 'visible'
                });

                // Give Southwest's JavaScript time to initialize
                await page.waitForTimeout(1000);

                // Step 2: Fill in all three fields on the SAME PAGE
                console.log('Filling confirmation number...');
                
                const confirmationSelectors = [
                    '#confirmationNumber',
                    '#confirmation-number',
                    'input[name="confirmationNumber"]',
                ];

                let confirmationFilled = false;
                for (const selector of confirmationSelectors) {
                    try {
                        const input = await page.$(selector);
                        if (input && await input.isVisible()) {
                            await input.click();
                            await input.fill(confirmationNumber);
                            confirmationFilled = true;
                            console.log(`Filled confirmation number using selector: ${selector}`);
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }

                if (!confirmationFilled) {
                    throw new Error('Could not find or fill confirmation number input field');
                }

                await page.waitForTimeout(500);

                // Step 3: Fill in first name (SAME PAGE)
                console.log('Filling first name...');
                
                const firstNameSelectors = [
                    '#firstName',
                    '#first-name',
                    'input[name="firstName"]',
                    'input[placeholder*="First"]',
                ];

                let firstNameFilled = false;
                for (const selector of firstNameSelectors) {
                    try {
                        const input = await page.$(selector);
                        if (input && await input.isVisible()) {
                            await input.click();
                            await input.fill(firstName);
                            firstNameFilled = true;
                            console.log(`Filled first name using selector: ${selector}`);
                            break;
                        }
                    } catch (e) {
                        console.log(`First name selector ${selector} failed:`, e.message);
                        continue;
                    }
                }

                if (!firstNameFilled) {
                    throw new Error('Could not find or fill first name input field');
                }

                await page.waitForTimeout(500);

                // Step 4: Fill in last name (SAME PAGE)
                console.log('Filling last name...');
                
                const lastNameSelectors = [
                    '#lastName',
                    '#last-name',
                    'input[name="lastName"]',
                    'input[placeholder*="Last"]',
                ];

                let lastNameFilled = false;
                for (const selector of lastNameSelectors) {
                    try {
                        const input = await page.$(selector);
                        if (input && await input.isVisible()) {
                            await input.click();
                            await input.fill(lastName);
                            lastNameFilled = true;
                            console.log(`Filled last name using selector: ${selector}`);
                            break;
                        }
                    } catch (e) {
                        console.log(`Last name selector ${selector} failed:`, e.message);
                        continue;
                    }
                }

                if (!lastNameFilled) {
                    throw new Error('Could not find or fill last name input field');
                }

                await page.waitForTimeout(1000);

                // Take screenshot after filling ALL fields
                const screenshotForm = await page.screenshot({ fullPage: false });
                await Actor.setValue('screenshot-form-filled', screenshotForm, { contentType: 'image/png' });
                result.screenshots.push('screenshot-form-filled');
                console.log('All fields filled successfully');

                // Step 5: Now click the "Check in" button
                console.log('Clicking check-in button...');
                
                const checkInButtonSelectors = [
                    'button[type="submit"]',
                    'button:has-text("Check in")',
                    '.button--yellow',
                    'button.button--yellow',
                ];

                let checkInClicked = false;
                for (const selector of checkInButtonSelectors) {
                    try {
                        const button = await page.$(selector);
                        if (button && await button.isVisible()) {
                            await button.click();
                            checkInClicked = true;
                            console.log(`Clicked check-in button using selector: ${selector}`);
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }

                if (!checkInClicked) {
                    throw new Error('Could not find or click check-in button');
                }

                console.log('Check-in button clicked, waiting for confirmation page...');

                // Wait for confirmation/boarding pass page
                await page.waitForTimeout(5000);

                // Take screenshot of boarding pass page
                const screenshotResult = await page.screenshot({ fullPage: true });
                await Actor.setValue('screenshot-result', screenshotResult, { contentType: 'image/png' });
                result.screenshots.push('screenshot-result');


                // Step 7: Extract boarding position
                console.log('Extracting boarding position...');
                
                // Try multiple selectors for boarding position
                const boardingSelectors = [
                    '.boarding-position',
                    '[data-qa="boarding-position"]',
                    '.boarding-group',
                    '.confirmation-number',
                ];

                let boardingPosition = null;

                // First try specific selectors
                for (const selector of boardingSelectors) {
                    try {
                        const element = await page.$(selector);
                        if (element) {
                            const text = await element.textContent();
                            const match = text.match(/([A-C])(\d{1,2})/);
                            if (match) {
                                boardingPosition = match[0];
                                break;
                            }
                        }
                    } catch (e) {
                        console.log(`Selector ${selector} failed:`, e.message);
                    }
                }

                // If still not found, search entire page content
                if (!boardingPosition) {
                    console.log('Searching entire page for boarding position...');
                    const pageContent = await page.content();
                    
                    // Look for patterns like "A24", "B15", "C60"
                    const patterns = [
                        /boarding\s+position[:\s]+([A-C]\d{1,2})/i,
                        /position[:\s]+([A-C]\d{1,2})/i,
                        /group[:\s]+([A-C])\s+position[:\s]+(\d{1,2})/i,
                        /([A-C]\d{1,2})/g
                    ];

                    for (const pattern of patterns) {
                        const match = pageContent.match(pattern);
                        if (match) {
                            if (match.length >= 3) {
                                // Pattern with separate group and position
                                boardingPosition = match[1] + match[2];
                            } else {
                                boardingPosition = match[1];
                            }
                            if (boardingPosition && /^[A-C]\d{1,2}$/.test(boardingPosition)) {
                                console.log(`Found boarding position with pattern: ${pattern}`);
                                break;
                            }
                        }
                    }
                }

                if (boardingPosition) {
                    console.log('✅ Successfully checked in! Boarding position:', boardingPosition);
                    result.success = true;
                    result.boardingPosition = boardingPosition;
                } else {
                    console.log('⚠️ Check-in may have succeeded but could not extract boarding position');
                    result.success = true; // Assume success if we got this far
                    result.boardingPosition = 'UNKNOWN';
                    result.error = 'Could not parse boarding position from page';
                }

                // Save full page HTML for debugging
                const html = await page.content();
                await Actor.setValue('final-page-html', html, { contentType: 'text/html' });

            } catch (error) {
                console.error('Error during check-in process:', error);
                result.error = error.message;
                
                // Take error screenshot
                try {
                    const screenshotError = await page.screenshot({ fullPage: true });
                    await Actor.setValue('screenshot-error', screenshotError, { contentType: 'image/png' });
                    result.screenshots.push('screenshot-error');
                } catch (screenshotErr) {
                    console.error('Could not take error screenshot:', screenshotErr);
                }
            }
        },
        maxRequestsPerCrawl: 1,
        maxConcurrency: 1,
    });

    // Run the crawler
    await crawler.run(['https://www.southwest.com/air/check-in/index.html']);

    // Push results to dataset
    await Actor.pushData(result);

    // Set output
    await Actor.setValue('OUTPUT', result);

    console.log('Actor finished. Result:', result);

} catch (error) {
    console.error('Fatal error:', error);
    await Actor.pushData({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
    });
    throw error;
}

await Actor.exit();
