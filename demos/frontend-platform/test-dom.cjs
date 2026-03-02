const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('http://localhost:8080');
    await page.waitForTimeout(2000); // wait for load

    const html = await page.evaluate(() => {
        const panels = document.querySelectorAll('.lm_item_container, .lm_content, .lm_component');
        return Array.from(panels).map(p => p.outerHTML).slice(0, 3);
    });

    console.log(html);
    await browser.close();
})();
