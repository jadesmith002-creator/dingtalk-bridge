const WebSocket = require('ws');
const https = require('https');
const crypto = require('crypto');

const CLIENT_ID = 'ding8vrf9ix5hm7c3umu';
const CLIENT_SECRET = '6BjsEdwiCW8eeZU7gAJIboQ4PEQJhVi79ICu6qDgqSRlG3UvJshKuvNNbULxIjVI';
const N8N_WEBHOOK = 'https://hcn.zeabur.app/webhook/competitor-research';

async function getEndpoint() {
  const ts = Date.now();
  const sign = crypto.createHmac('sha256', CLIENT_SECRET).update(ts + '\n' + CLIENT_ID).digest('base64');
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.dingtalk.com',
      path: '/v1.0/gateway/connections/open',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(JSON.stringify({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, subscriptions: [{ type: 'EVENT', topic: '/v1.0/im/bot/messages/get' }] }));
    req.end();
  });
}

async function connect() {
  const { endpoint, ticket } = await getEndpoint();
  const ws = new WebSocket(`${endpoint}?ticket=${ticket}`);
  
  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw);
    ws.send(JSON.stringify({ code: 200, headers: msg.headers, message: 'OK', data: {} }));
    
    if (msg.type === 'EVENT') {
      console.log('完整消息:', JSON.stringify(msg));
const content = msg.data?.text?.content || msg.data?.content || msg.data?.messageContent || '';
const sessionWebhook = msg.data?.sessionWebhook || msg.data?.robotCode || '';
      console.log('收到消息:', content);
      
      const body = JSON.stringify({ body: { text: { content }, sessionWebhook } });
      const url = new URL(N8N_WEBHOOK);
      const req = https.request({ hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
      req.write(body);
      req.end();
    }
  });
  
  ws.on('close', () => setTimeout(connect, 3000));
  ws.on('error', e => { console.error(e.message); setTimeout(connect, 3000); });
  ws.on('open', () => console.log('钉钉 Stream 已连接'));
}

connect();
