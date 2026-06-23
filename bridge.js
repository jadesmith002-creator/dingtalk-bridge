const { DWClient } = require('@dingtalk/dingtalk_stream');
const fetch = require('node-fetch');

const CLIENT_ID = 'ding8vrf9ix5hm7c3umu';
const CLIENT_SECRET = '6BjsEdwiCW8eeZU7gAJIboQ4PEQJhVi79ICu6qDgqSRlG3UvJshKuvNNbULxIjVI';
const N8N_WEBHOOK = 'https://hcn.zeabur.app/webhook/competitor-research';

const client = new DWClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

client.registerCallbackListener('/v1.0/im/bot/messages/get', async (res) => {
  try {
    const data = res.data || {};
    const content = data.text?.content || data.messageContent || '';
    const sessionWebhook = data.sessionWebhook || '';

    console.log('收到消息:', content);

    await fetch(N8N_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: {
          text: { content: content.replace(/@\S+/g, '').trim() },
          sessionWebhook: sessionWebhook,
          senderStaffId: data.senderStaffId || '',
          conversationId: data.conversationId || ''
        }
      })
    });

    console.log('已转发到 n8n');
  } catch (e) {
    console.error('转发失败:', e.message);
  }

  return { status: 'ok' };
});

client.start().then(() => {
  console.log('钉钉 Stream 桥接服务已启动');
}).catch(e => {
  console.error('启动失败:', e.message);
  process.exit(1);
});
