const WebSocket = require('ws');
const https = require('https');

const CLIENT_ID = 'ding8vrf9ix5hm7c3umu';
const CLIENT_SECRET = '6BjsEdwiCW8eeZU7gAJIboQ4PEQJhVi79ICu6qDgqSRlG3UvJshKuvNNbULxIjVI';
const N8N_WEBHOOK = 'https://hcn.zeabur.app/webhook/competitor-research';

async function getEndpoint() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      subscriptions: [
        { type: 'CALLBACK', topic: '/v1.0/im/bot/messages/get' }
      ]
    });
    const req = https.request({
      hostname: 'api.dingtalk.com',
      path: '/v1.0/gateway/connections/open',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function connect() {
  try {
    const result = await getEndpoint();
    console.log('获取endpoint成功');
    const { endpoint, ticket } = result;
    const ws = new WebSocket(`${endpoint}?ticket=${ticket}`);

    ws.on('open', () => console.log('钉钉 Stream 已连接'));

    ws.on('message', async (raw) => {
      const msg = JSON.parse(raw.toString());
      console.log('收到消息:', JSON.stringify(msg));

      // 先回包，否则钉钉会重发
      ws.send(JSON.stringify({
        code: 200,
        headers: msg.headers,
        message: 'OK',
        data: '{"response": null}'
      }));

      // 处理机器人消息回调
      if (msg.type === 'CALLBACK') {
        const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
        const content = (data.text?.content || data.content || '').replace(/@\S+/g, '').trim();
        const sessionWebhook = data.sessionWebhook || '';
        console.log('消息内容:', content);

        const body = JSON.stringify({ body: { text: { content }, sessionWebhook } });
        const url = new URL(N8N_WEBHOOK);
        const req = https.request({
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => { res.on('data', () => {}); });
        req.on('error', e => console.error('转发失败:', e.message));
        req.write(body);
        req.end();
        console.log('已转发到 n8n');
      }
    });

    ws.on('close', () => { console.log('连接断开，3秒后重连'); setTimeout(connect, 3000); });
    ws.on('error', e => { console.error('错误:', e.message); setTimeout(connect, 3000); });

  } catch(e) {
    console.error('启动失败:', e.message);
    setTimeout(connect, 3000);
  }
}

connect();
