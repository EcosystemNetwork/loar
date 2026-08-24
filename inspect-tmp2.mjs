import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 2560, height: 1300 }, deviceScaleFactor: 1 });
await page.goto('https://loar.fun', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);
// dismiss cookie banner if present
try { await page.click('text=Accept all', { timeout: 2000 }); } catch {}
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/claude-1000/-home-god-Desktop-loar-loar/6a3427dd-dbb9-43b3-bd23-8778ee1bec4b/scratchpad/loar-home-wide.png' });

const info = await page.evaluate(() => {
  const header = document.querySelector('header');
  const tickerWrap = Array.from(document.querySelectorAll('div')).find(d => d.className && typeof d.className === 'string' && d.className.includes('border-b') && d.className.includes('bg-white/[0.02]'));
  const featuredBadge = Array.from(document.querySelectorAll('*')).find(el => el.textContent.trim() === 'Featured' && el.children.length === 0);
  function rect(el){ return el ? el.getBoundingClientRect().toJSON() : null; }
  return {
    header: rect(header),
    tickerWrap: rect(tickerWrap),
    featuredBadgeRect: rect(featuredBadge),
    featuredBadgeParentRect: featuredBadge ? rect(featuredBadge.closest('div.relative.isolate')) : null,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
