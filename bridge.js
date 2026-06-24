const WebSocket = require('ws');
const https = require('https');
const zlib = require('zlib');

// ── 配置 ──
const DING_APP_KEY    = 'ding8vrf9ix5hm7c3umu';
const DING_APP_SECRET = '6BjsEdwiCW8eeZU7gAJIboQ4PEQJhVi79ICu6qDgqSRlG3UvJshKuvNNbULxIjVI';
const SF_KEY          = 'eeflofzxowplaui3mnyvbhermg5pdz09';
const SF_HOST         = 'standardapi.sorftime.com';
const SHEET_ID        = '87wCBch';
const CHROMIUM        = '/usr/bin/chromium-browser';
const DOMAIN          = { US:1, GB:2, DE:3, FR:4, IN:5, CA:6, JP:7, ES:8, IT:9, MX:10, AE:11, AU:12, BR:13, SA:14 };

// ── 通用 HTTPS POST ──
function post(hostname, path, body, headers = {}) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Content-Length': Buffer.byteLength(data), ...headers }
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks))); } catch { resolve(Buffer.concat(chunks).toString()); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Sorftime REST API（返回 gzip+base64，自动解压）──
async function sf(endpoint, body, domain) {
  const res = await post(SF_HOST, `/api/${endpoint}?domain=${domain}`, body, {
    'Authorization': `BasicAuth ${SF_KEY}`
  });
  if (res && res.Data) {
    const buf = Buffer.from(res.Data, 'base64');
    return new Promise((resolve, reject) =>
      zlib.gunzip(buf, (e, r) => e ? reject(e) : resolve(JSON.parse(r.toString())))
    );
  }
  return res;
}

// ── 钉钉工具 ──
async function getDingToken() {
  const r = await post('api.dingtalk.com', '/v1.0/oauth2/accessToken',
    { appKey: DING_APP_KEY, appSecret: DING_APP_SECRET });
  return r.accessToken;
}

async function replyDing(webhook, text) {
  if (!webhook) return;
  const url = new URL(webhook);
  return post(url.hostname, url.pathname + url.search, { msgtype: 'text', text: { content: text } });
}

// ── 解析消息 ──
function parse(text) {
  let s = text.replace(/@[^\s]*/g, '').replace(/调研|抓取|搜索|竞对|竞品/g, '');
  let priceMin = null, priceMax = null;
  const pm = s.match(/价格\s*(\d+)[-~到](\d+)/);
  if (pm) { priceMin = +pm[1]; priceMax = +pm[2]; s = s.replace(pm[0], ''); }
  let amzSite = 'US';
  const sm = s.match(/(?:^|\s)(US|GB|DE|FR|JP|CA|IT|ES|MX|AU)(?:\s|$)/i);
  if (sm) { amzSite = sm[1].toUpperCase(); s = s.replace(sm[0], ' '); }
  return { searchName: s.replace(/\s+/g, ' ').trim(), amzSite, priceMin, priceMax };
}

// ── 完整 SOP ──
async function runSOP({ searchName, amzSite, priceMin, priceMax }, webhook) {
  const domain = DOMAIN[amzSite] || 1;
  await replyDing(webhook, `⏳ 开始调研「${searchName}」，完成后通知你...`);

  // Step1: 翻页搜索 + 过滤（REST API 用大驼峰参数名）
  const seen = new Set(), products = [];
  for (let page = 1; ; page++) {
    const body = {
      Page: page,
      MonthSaleVolumeRangeMin: 300,
      AttributeName: searchName
    };
    if (priceMin) body.PriceRangeMin = priceMin;
    if (priceMax) body.PriceRangeMax = priceMax;

    let data;
    try { data = await sf('ProductSearch', body, domain); }
    catch(e) { console.log('搜索出错:', e.message); break; }

    const list = (data && data.Data) || (data && data.data) || [];
    if (!list.length) break;

    let stop = false;
    for (const item of list) {
      const sales = item.MonthSaleVolume || item.monthSalesVolume || 0;
      if (sales < 300) { stop = true; break; }
      const country = (item.SellerCountry || item.sellerCountry || '').toUpperCase();
      if (!country.includes('CN') && !country.includes('CHINA')) continue;
      const weight = item.WeightG || item.weightG || item.itemWeight || 9999;
      if (weight > 680) continue;
      const pk = item.ParentAsin || item.parentAsin || item.Asin || item.asin;
      if (seen.has(pk)) continue;
      seen.add(pk);
      products.push({
        asin: item.Asin || item.asin,
        parentAsin: pk,
        title: item.Title || item.title || '',
        price: item.Price || item.price || 0,
        monthSales: sales,
        rating: item.Star || item.rating || 0,
        reviewCount: item.ReviewCount || item.reviewCount || 0,
        imageUrl: item.ImageUrl || item.imageUrl || '',
        weightG: weight,
        sellerCountry: country,
        merchantId: item.MerchantId || item.merchantId || '',
        sellerName: item.SellerName || item.sellerName || ''
      });
    }
    if (stop || list.length < 20) break;
    await new Promise(r => setTimeout(r, 300));
  }

  if (!products.length) { await replyDing(webhook, `❌ 未找到符合条件的产品`); return; }
  console.log(`Step1: ${products.length}个产品`);

  // Step2: ProductRequest（产品详情）
  for (const p of products) {
    try {
      const d = await sf('ProductRequest', { Asin: p.asin }, domain);
      const det = (d && d.Data) || (d && d.data) || d || {};
      const b = det.BulletPoints || det.Bullets || det.bullets || [];
      Object.assign(p, {
        brand: det.Brand || det.brand || '',
        listingDate: det.ListingDate || det.listingDate || det.listing_date || '',
        bsrMain: det.BsrMain || det.bsrMain || det.bsr_main || '',
        bsrSub: det.BsrSub || det.bsrSub || det.bsr_sub || '',
        bullet1: b[0]||'', bullet2: b[1]||'', bullet3: b[2]||'',
        bullet4: b[3]||'', bullet5: b[4]||'',
        description: det.Description || det.description || '',
        productUrl: 'https://www.amazon.com/dp/' + p.asin
      });
    } catch { p.productUrl = 'https://www.amazon.com/dp/' + p.asin; }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('Step2: 详情完成');

  // Step3: ASINRequestKeyword（ASIN反查关键词）
  const kwMap = {};
  const top10 = [...products].sort((a, b) => b.monthSales - a.monthSales).slice(0, 10);
  for (const p of top10) {
    try {
      const d = await sf('ASINRequestKeyword', { Asin: p.asin, Page: 1 }, domain);
      const list = (d && d.Data) || (d && d.data) || (d && d.list) || [];
      for (const t of list) {
        const kw = t.Keyword || t.keyword || t.term || '';
        if (kw) kwMap[kw] = (kwMap[kw] || 0) + (t.SearchVolume || t.searchVolume || t.weekSearchVolume || 1);
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  const keywords = Object.entries(kwMap).sort((a,b) => b[1]-a[1]).slice(0,30).map(([k])=>k).join(' | ');
  console.log('Step3: 关键词完成');

  // Step4: 卖家地址（Playwright）
  const addrMap = {};
  try {
    const { chromium } = require('playwright');
    const sellers = [...new Set(products.map(p => p.merchantId).filter(Boolean))];
    for (const mid of sellers) {
      try {
        const browser = await chromium.launch({
          executablePath: CHROMIUM,
          args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--headless']
        });
        const page = await browser.newPage();
        await page.goto(`https://www.amazon.com/sp?seller=${mid}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);
        addrMap[mid] = await page.evaluate(() => {
          for (const el of document.querySelectorAll('.a-section')) {
            if ((el.innerText||'').includes('Business Address'))
              return el.innerText.replace('Business Address','').trim();
          }
          const m = document.body.innerText.match(/([^\n]*(Shenzhen|Guangzhou|Hangzhou|Yiwu|Ningbo|Dongguan|Guangdong|Zhejiang|Fujian)[^\n]*)/i);
          return m ? m[0].trim() : '未找到地址';
        });
        await browser.close();
      } catch { addrMap[mid] = '抓取失败'; }
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch(e) { console.log('Playwright不可用:', e.message); }
  console.log('Step4: 地址完成');

  // Step5: 写入钉钉多维表
  const token = await getDingToken();
  const records = products.map(p => ({ fields: {
    '类目': searchName, 'ASIN': p.asin, '图片': p.imageUrl||'',
    '品牌': p.brand||'', '上架时间': p.listingDate||'',
    '产品链接': p.productUrl||'', '国家': p.sellerCountry,
    '省份': addrMap[p.merchantId]||'', '城市': '',
    '具体地址': addrMap[p.merchantId]||'', '审核状态': '待审核',
    '销量': p.monthSales, '评分': p.rating,
    '大类排名': p.bsrMain||'', '细分类目排名': p.bsrSub||'',
    '标题': p.title, '卖点1': p.bullet1||'', '卖点2': p.bullet2||'',
    '卖点3': p.bullet3||'', '卖点4': p.bullet4||'', '卖点5': p.bullet5||'',
    '描述': p.description||''
  }}));

  for (let i = 0; i < records.length; i += 50) {
    await post('api.dingtalk.com',
      `/v1.0/doc/multiDimensional/tables/${SHEET_ID}/records/batchCreate`,
      { records: records.slice(i, i+50) },
      { 'x-acs-dingtalk-access-token': token });
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`Step5: ${records.length}条写入完成`);
  await replyDing(webhook, `✅ 调研完成！\n关键词：${searchName}\n共写入 ${records.length} 条\n钉钉多维表已更新`);
}

// ── 钉钉 Stream ──
async function connect() {
  try {
    const { endpoint, ticket } = await post('api.dingtalk.com', '/v1.0/gateway/connections/open', {
      clientId: DING_APP_KEY, clientSecret: DING_APP_SECRET,
      subscriptions: [{ type: 'CALLBACK', topic: '/v1.0/im/bot/messages/get' }]
    });
    const ws = new WebSocket(`${endpoint}?ticket=${ticket}`);
    ws.on('open', () => console.log('钉钉 Stream 已连接'));
    ws.on('message', async raw => {
      const msg = JSON.parse(raw.toString());
      ws.send(JSON.stringify({ code: 200, headers: msg.headers, message: 'OK', data: '{}' }));
      if (msg.type !== 'CALLBACK') return;
      const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
      const text = ((data.text && data.text.content) || '').replace(/@[^\s]*/g, '').trim();
      const webhook = data.sessionWebhook || '';
      if (!text) return;
      console.log('收到:', text);
      const params = parse(text);
      if (!params.searchName) {
        await replyDing(webhook, '❌ 格式：调研 cargo pants US 价格15-50');
        return;
      }
      runSOP(params, webhook).catch(async e => {
        console.error('出错:', e.message);
        await replyDing(webhook, '❌ 出错：' + e.message);
      });
    });
    ws.on('close', () => setTimeout(connect, 3000));
    ws.on('error', () => setTimeout(connect, 3000));
  } catch(e) { console.error(e.message); setTimeout(connect, 3000); }
}

connect();
