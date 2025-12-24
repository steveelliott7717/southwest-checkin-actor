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

    // Configure proxy (optional, but recommended for reliability)
    const proxyConfiguration = await Actor.createProxyConfiguration();

    // Create crawler
    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
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
                    waitUntil: 'networkidle',
                    timeout: 30000,
                });

                // Take screenshot of initial page
                const screenshotInitial = await page.screenshot({ fullPage: false });
                await Actor.setValue('screenshot-initial', screenshotInitial, { contentType: 'image/png' });
                result.screenshots.push('screenshot-initial');
                console.log('Initial page loaded');

                // Wait for form to be visible
                await page.waitForSelector('#form-mixin--air-check-in-form', { timeout: 10000 });

                // Step 2: Fill in confirmation number
                console.log('Filling confirmation number...');
                const confirmationInput = await page.$('#confirmationNumber, #confirmation-number, input[name="confirmationNumber"]');
                if (!confirmationInput) {
                    throw new Error('Could not find confirmation number input field');
                }
                await confirmationInput.fill(confirmationNumber);
                await page.waitForTimeout(500); // Small delay to mimic human

                // Step 3: Fill in first name
                console.log('Filling first name...');
                const firstNameInput = await page.$('#firstName, #first-name, input[name="firstName"]');
                if (!firstNameInput) {
                    throw new Error('Could not find first name input field');
                }
                await firstNameInput.fill(firstName);
                await page.waitForTimeout(500);

                // Step 4: Fill in last name
                console.log('Filling last name...');
                const lastNameInput = await page.$('#lastName, #last-name, input[name="lastName"]');
                if (!lastNameInput) {
                    throw new Error('Could not find last name input field');
                }
                await lastNameInput.fill(lastName);
                await page.waitForTimeout(500);

                // Take screenshot after filling form
                const screenshotForm = await page.screenshot({ fullPage: false });
                await Actor.setValue('screenshot-form-filled', screenshotForm, { contentType: 'image/png' });
                result.screenshots.push('screenshot-form-filled');
                console.log('Form filled');

                // Step 5: Click "Check In" button to retrieve reservation
                console.log('Clicking retrieve reservation button...');
                const retrieveButton = await page.$('button[type="submit"], button:has-text("Check In"), .button--yellow');
                if (!retrieveButton) {
                    throw new Error('Could not find retrieve reservation button');
                }
                
                await retrieveButton.click();
                console.log('Retrieve button clicked, waiting for next page...');

                // Wait for navigation to check-in confirmation page
                await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {
                    console.log('Navigation wait timed out, checking if we reached check-in page anyway...');
                });

                // Alternative: wait for check-in button to appear
                await page.waitForSelector('button:has-text("Check in"), .check-in-button, button[data-qa="check-in-button"]', {
                    timeout: 15000,
                }).catch(() => {
                    console.log('Check-in button not found by selector, searching DOM...');
                });

                // Take screenshot of check-in page
                const screenshotCheckin = await page.screenshot({ fullPage: true });
                await Actor.setValue('screenshot-checkin-page', screenshotCheckin, { contentType: 'image/png' });
                result.screenshots.push('screenshot-checkin-page');
                console.log('On check-in confirmation page');

                // Step 6: Click final "Check In" button
                console.log('Clicking final check-in button...');
                const checkInButton = await page.$('button:has-text("Check in"), .check-in-button, button[data-qa="check-in-button"]');
                if (!checkInButton) {
                    // Try alternate selectors
                    const alternateButton = await page.$('button.button--yellow, button[type="submit"]');
                    if (alternateButton) {
                        await alternateButton.click();
                        console.log('Clicked alternate check-in button');
                    } else {
                        throw new Error('Could not find final check-in button');
                    }
                } else {
                    await checkInButton.click();
                    console.log('Check-in button clicked!');
                }

                // Wait for confirmation page
                await page.waitForTimeout(3000); // Give it time to process

                // Take screenshot of results
                const screenshotResult = await page.screenshot({ fullPage: true });
                await Actor.setValue('screenshot-result', screenshotResult, { contentType: 'image/png' });
                result.screenshots.push('screenshot-result');

                // Step 7: Extract boarding position
                console.log('Extracting boarding position...');
                
                // Try multiple selectors for boarding position
                const boardingSelectors = [
                    '.boarding-position',
                    '[data-qa="boarding-position"]',
                    'text=/[A-C][0-9]{1,2}/',
                    '.confirmation-number', // Sometimes near confirmation
                ];

                let boardingPosition = null;
                for (const selector of boardingSelectors) {
                    try {
                        const element = await page.$(selector);
                        if (element) {
                            const text = await element.textContent();
                            // Extract pattern like A24, B15, C60
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
                    const pageContent = await page.content();
                    const match = pageContent.match(/boarding position.*?([A-C]\d{1,2})/i);
                    if (match) {
                        boardingPosition = match[1];
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
