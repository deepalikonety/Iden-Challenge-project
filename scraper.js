const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  baseUrl: 'https://hiring.idenhq.com',
  credentialsPath: path.join(__dirname, 'credentials.json'),
  sessionPath: path.join(__dirname, 'session.json'),
  outputPath: path.join(__dirname, 'product_data.json')
};

// Debug flag (set to false to disable debugging features)
const debug = false;

// Load credentials from a separate file (more secure)
const loadCredentials = () => {
  try {
    return JSON.parse(fs.readFileSync(config.credentialsPath, 'utf8'));
  } catch (error) {
    console.error('Failed to load credentials:', error);
    return { username: 'deepalikonety@gmail.com', password: 'Kdk8lYD9' };
  }
};

// Main function
async function harvestProductData() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  let page;

  try {
    // Try to restore session if it exists
    if (fs.existsSync(config.sessionPath)) {
      console.log('Attempting to restore previous session...');
      const sessionData = JSON.parse(fs.readFileSync(config.sessionPath, 'utf8'));
      await context.addCookies(sessionData.cookies);
      page = await context.newPage();

      await page.goto(`${config.baseUrl}/instructions`);
      const isLoggedIn = await page.isVisible('text=Sign out', { timeout: 5000 }).catch(() => false);

      if (!isLoggedIn) {
        console.log('Session expired, logging in again...');
        await login(page);
      } else {
        console.log('Session restored successfully!');
      }
    } else {
      page = await context.newPage();
      await page.goto(config.baseUrl);
      await login(page);
    }

    // Navigate to the product dashboard
    console.log('Navigating to product dashboard...');
    await navigateToProductDashboard(page);

    // Extract product data
    console.log('Extracting product data...');
    const products = await extractAllProductData(page);

    // Save the extracted data
    fs.writeFileSync(config.outputPath, JSON.stringify(products, null, 2));
    console.log(`Successfully extracted ${products.length} products to ${config.outputPath}`);

    // Save session for future use
    const cookies = await context.cookies();
    fs.writeFileSync(config.sessionPath, JSON.stringify({ cookies }));
    console.log('Session saved for future use');

    // Sign out after completing the extraction
    console.log('Signing out...');
    await signOut(page);

  } catch (error) {
    console.error('An error occurred:', error);

    // Capture screenshot on error (only in debug mode)
    if (debug && page) {
      const screenshotPath = path.join(__dirname, 'error_screenshot.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Screenshot saved to ${screenshotPath}`);
    }

    // Attempt to sign out in case of error
    try {
      console.log('Attempting to sign out due to error...');
      await signOut(page);
    } catch (signOutError) {
      console.error('Error signing out:', signOutError);
    }
  } finally {
    // Close the browser
    if (page) {
      console.log('Closing the browser...');
      await browser.close();
    }
  }
}

// Login function
async function login(page) {
  const credentials = loadCredentials();

  try {
    // Navigate to login page if not already there
    if (!page.url().includes('login')) {
      await page.goto(`${config.baseUrl}`);
    }

    console.log('Waiting for login form...');
    await page.waitForSelector('input[type="email"]', { state: 'visible', timeout: 10000 });
    await page.fill('input[type="email"]', credentials.username);

    await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 5000 });
    await page.fill('input[type="password"]', credentials.password);

    console.log('Filled login credentials, submitting form...');

    // Click the login button
    const loginButton = await page.$('button:has-text("Sign in")') ||
      await page.$('button[type="submit"]');

    if (loginButton) {
      await loginButton.click();
    } else {
      throw new Error('Login button not found');
    }

    // Wait for navigation to complete
    await page.waitForURL('**/instructions', { timeout: 30000 })
      .catch(() => console.log('URL change timeout, continuing anyway'));

    // Additional wait to ensure page is loaded
    await page.waitForTimeout(3000);

    // Verify we are logged in by checking for "Sign out" text
    const isLoggedIn = await page.isVisible('text=Sign out', { timeout: 5000 })
      .catch(() => false);

    if (!isLoggedIn) {
      throw new Error('Login failed. Please check your credentials.');
    }

    console.log('Login successful!');

  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
}

// Navigate to product dashboard
async function navigateToProductDashboard(page) {
  try {
    // First, navigate to the instructions page
    await page.goto(`${config.baseUrl}/instructions`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000); // Extra wait for any scripts to initialize

    console.log('On instructions page, looking for "Launch Challenge" button');

    // Scroll down to find the "Launch Challenge" button
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    await page.waitForTimeout(1000); // Wait for scroll to complete

    // Try multiple strategies to find and click the launch button
    let buttonFound = false;

    // Strategy 1: Direct selector
    const launchButton = await page.$('button:has-text("Launch Challenge")');
    if (launchButton) {
      console.log('Found Launch Challenge button directly');
      await launchButton.click();
      buttonFound = true;
    }

    // Strategy 2: Text content search
    if (!buttonFound) {
      console.log('Trying to find button by text content...');
      const allButtons = await page.$$('button');
      for (const button of allButtons) {
        const buttonText = await button.textContent();
        if (buttonText.includes('Launch Challenge')) {
          console.log('Found button by text content match');
          await button.click();
          buttonFound = true;
          break;
        }
      }
    }

    // Strategy 3: Link instead of button
    if (!buttonFound) {
      console.log('Looking for link instead of button...');
      const launchLink = await page.$('a:has-text("Launch Challenge")');
      if (launchLink) {
        console.log('Found Launch Challenge as a link');
        await launchLink.click();
        buttonFound = true;
      }
    }

    // Strategy 4: Try any clickable elements with matching text
    if (!buttonFound) {
      console.log('Trying to find by any element with matching text...');
      await page.click('text="Launch Challenge"', { timeout: 5000 })
        .then(() => {
          console.log('Found and clicked element with text "Launch Challenge"');
          buttonFound = true;
        })
        .catch(() => console.log('No element with text "Launch Challenge" found'));
    }

    if (!buttonFound) {
      throw new Error('Could not find or click Launch Challenge button');
    }

    console.log('Button clicked, waiting for dashboard to load...');
    await page.waitForTimeout(5000);
    const dashboardVisible = await page.isVisible('text="Product Dashboard"', { timeout: 10000 })
      .catch(() => false);

    if (dashboardVisible) {
      console.log('Successfully navigated to Product Dashboard');
    } else {
      console.log('Dashboard title not found, checking for product elements instead');
      const productElements = await page.isVisible('[id*="product"], [class*="product"]', { timeout: 5000 })
        .catch(() => false);

      if (productElements) {
        console.log('Product elements found on page, proceeding with extraction');
      } else {
        console.log('No product elements found. Current URL:', page.url());
        throw new Error('Failed to navigate to product dashboard');
      }
    }

  } catch (error) {
    console.error('Error navigating to product dashboard:', error);
    throw error;
  }
}

// Extract data from a single page
async function extractProductDataFromPage(page) {
  const products = [];

  try {
    console.log('Looking for product elements on the page');
    await page.waitForTimeout(3000);
    const selectors = [
      '.product-card',
      '[class*="product"]',
      '[class*="collection"]',
      '[class*="bundle"]',
      'div[id*="product"]',
      'div[class*="card"]',
      'div[class*="item"]'
    ];

    let productElements = [];
    let usedSelector = '';

    for (const selector of selectors) {
      console.log(`Trying to find products with selector: ${selector}`);
      const elements = await page.$$(selector);
      if (elements.length > 0) {
        console.log(`Found ${elements.length} products with selector: ${selector}`);
        productElements = elements;
        usedSelector = selector;
        break;
      }
    }

    if (productElements.length === 0) {
      throw new Error('Could not find any product data on the page');
    }
    console.log(`Processing ${productElements.length} product elements`);

    for (const element of productElements) {
      try {
        const product = await element.evaluate(el => {
          const product = {};

          const titleElement = el.querySelector('h2, h3, h4, [class*="title"], [class*="header"]');
          if (titleElement) {
            product.title = titleElement.textContent.trim();
          }

          const dataElements = el.querySelectorAll('div, span, p');

          dataElements.forEach(dataEl => {
            const text = dataEl.textContent.trim();

            if (text.match(/^ID:?\s*(\d+)$/i)) {
              product.id = parseInt(text.match(/^ID:?\s*(\d+)$/i)[1], 10);
            } else if (text.match(/^Rating:?\s*(\d+(\.\d+)?)$/i)) {
              product.rating = parseFloat(text.match(/^Rating:?\s*(\d+(\.\d+)?)$/i)[1]);
            } else if (text.match(/^Shade:?\s*(.+)$/i)) {
              product.shade = text.match(/^Shade:?\s*(.+)$/i)[1];
            } else if (text.match(/^Type:?\s*(.+)$/i)) {
              product.type = text.match(/^Type:?\s*(.+)$/i)[1];
            }

            const keyValueMatch = text.match(/^([^:]+):\s*(.+)$/);
            if (keyValueMatch) {
              const [_, key, value] = keyValueMatch;
              if (key && value) {
                product[key.toLowerCase().trim()] = value.trim();
              }
            }
          });

          return product;
        });

        if (Object.keys(product).length > 0) {
          products.push(product);
        }
      } catch (error) {
        console.error(`Error extracting data from product element:`, error);
      }
    }

    console.log(`Successfully extracted ${products.length} products from current page`);
    return { products, usedSelector };

  } catch (error) {
    console.error('Error extracting product data from page:', error);
    return { products: [], usedSelector: '' };
  }
}

// Scroll the page to load more products
async function scrollPage(page) {
  console.log('Scrolling to load more products...');
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight || totalHeight >= 5000) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
    });
  });
}

// Extract all product data across all pages
async function extractAllProductData(page) {
  const allProducts = [];
  let previousProductCount = 0;
  let attempts = 0;
  const maxAttempts = 10;

  console.log('Starting extraction of all product data...');

  while (attempts < maxAttempts) {
    const { products, usedSelector } = await extractProductDataFromPage(page);
    allProducts.push(...products);

    console.log(`Total products found so far: ${allProducts.length}`);

    // Check if no new products were loaded
    if (products.length === previousProductCount) {
      attempts++;
      console.log(`No new products loaded after scroll, attempt ${attempts}/${maxAttempts}`);
    } else {
      attempts = 0; 
    }

    previousProductCount = products.length;
    await scrollPage(page);
    await page.waitForTimeout(5000); 

    if (allProducts.length >= 1000) {
      console.log('Reached 1000 products, stopping extraction');
      break;
    }
  }

  console.log(`Finished extracting ${allProducts.length} products`);
  return allProducts;
}

// Function to sign out
async function signOut(page) {
  try {
    console.log('Looking for the "Sign out" button...');

    await page.waitForSelector('button:has-text("Sign out")', { state: 'visible', timeout: 10000 });

    const initialUrl = page.url();

    await page.click('button:has-text("Sign out")');
    console.log('Clicked the "Sign out" button');

    await page.waitForFunction(
      (initialUrl) => window.location.href !== initialUrl,
      initialUrl,
      { timeout: 10000 }
    );

    console.log('Successfully signed out and redirected to the login page');

    await page.waitForSelector('input[type="email"]', { state: 'visible', timeout: 10000 });
    console.log('Login page loaded successfully');

    // Keep the browser open for 5 seconds to allow the user to see the login page
    await page.waitForTimeout(5000);
  } catch (error) {
    console.error('Error signing out:', error);
    throw error;
  }
}

// Execute the main function
harvestProductData().catch(console.error);