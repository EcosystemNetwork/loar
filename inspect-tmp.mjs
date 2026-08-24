import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('https://loar.fun', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);

await page.screenshot({ path: '/tmp/claude-1000/-home-god-Desktop-loar-loar/6a3427dd-dbb9-43b3-bd23-8778ee1bec4b/scratchpad/loar-home.png' });

const info = await page.evaluate(() => {
  function findByText(re) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const results = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.children.length === 0 && re.test(node.textContent || '')) {
        results.push(node);
      }
    }
    return results;
  }
  const out = {};
  // header
  const header = document.querySelector('header');
  if (header) out.header = { rect: header.getBoundingClientRect().toJSON(), cs: getComputedStyle(header).position + ' z=' + getComputedStyle(header).zIndex };

  // ticker: find element containing "launched" text with animate ticker class
  const tickerCandidates = Array.from(document.querySelectorAll('div')).filter(d => d.className && typeof d.className === 'string' && d.className.includes('ticker'));
  out.tickerCandidates = tickerCandidates.map(el => ({
    cls: el.className,
    rect: el.getBoundingClientRect().toJSON(),
    parentCls: el.parentElement ? el.parentElement.className : null,
    parentRect: el.parentElement ? el.parentElement.getBoundingClientRect().toJSON() : null,
    cs: { position: getComputedStyle(el).position, zIndex: getComputedStyle(el).zIndex, transform: getComputedStyle(el).transform }
  }));

  // hero: find element with "Featured" badge text
  const featuredEls = findByText(/^Featured$/);
  out.featured = featuredEls.map(el => ({
    rect: el.getBoundingClientRect().toJSON(),
    tag: el.tagName,
    cls: el.className,
  }));
  // walk up from featured to find hero container (has isolate class)
  if (featuredEls[0]) {
    let cur = featuredEls[0];
    const chain = [];
    for (let i = 0; i < 8 && cur; i++) {
      chain.push({
        tag: cur.tagName,
        cls: typeof cur.className === 'string' ? cur.className : '',
        rect: cur.getBoundingClientRect().toJSON(),
        cs: { position: getComputedStyle(cur).position, zIndex: getComputedStyle(cur).zIndex, marginTop: getComputedStyle(cur).marginTop, top: getComputedStyle(cur).top },
      });
      cur = cur.parentElement;
    }
    out.chain = chain;
  }
  return out;
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
