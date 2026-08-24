import { chromium } from 'playwright';

const sizes = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

const browser = await chromium.launch({ args: ['--no-sandbox'] });
for (const size of sizes) {
  const page = await browser.newPage({ viewport: size });
  await page.goto('https://loar.fun', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  try { await page.click('text=Accept all', { timeout: 1500 }); } catch {}
  await page.waitForTimeout(300);
  const name = `/tmp/claude-1000/-home-god-Desktop-loar-loar/6a3427dd-dbb9-43b3-bd23-8778ee1bec4b/scratchpad/loar-${size.width}x${size.height}.png`;
  await page.screenshot({ path: name });
  const gap = await page.evaluate(() => {
    const tickerWrap = Array.from(document.querySelectorAll('div')).find(d => d.className && typeof d.className === 'string' && d.className.includes('border-b') && d.className.includes('bg-white/[0.02]'));
    const hero = document.querySelector('div.relative.isolate.overflow-hidden') || Array.from(document.querySelectorAll('div')).find(d => d.className && d.className.includes('isolate') && d.className.includes('overflow-hidden'));
    if (!tickerWrap || !hero) return { tickerFound: !!tickerWrap, heroFound: !!hero };
    const t = tickerWrap.getBoundingClientRect();
    const h = hero.getBoundingClientRect();
    return { tickerBottom: t.bottom, heroTop: h.top, gap: h.top - t.bottom };
  });
  console.log(size, gap);
  await page.close();
}
await browser.close();
