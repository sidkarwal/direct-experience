const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { email } = body;
  if (!email || !email.includes('@')) {
    return { statusCode: 400, body: 'Invalid email' };
  }

  try {
    const store = getStore('subscribers');
    const key = email.toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
    await store.setJSON(key, {
      email: email.toLowerCase(),
      subscribed_at: new Date().toISOString(),
      active: true,
    });

    if (process.env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Direct Experience <dispatch@directexperience.now>',
          to: [email],
          subject: 'Thus have I heard.',
          html: `<div style="max-width:560px;margin:0 auto;padding:40px 24px;background:#09090a;color:#ddd8ce;font-family:Georgia,serif;font-size:16px;line-height:1.75;">
            <p style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#7a6040;margin-bottom:24px;">Direct Experience</p>
            <p>You are on the list.</p>
            <p style="margin-top:16px;">Once a week, one account. The most precise, the most significant. What happened — and where every tradition has seen it before.</p>
            <p style="margin-top:24px;font-size:13px;color:#5c5850;font-family:Helvetica,Arial,sans-serif;">No belief required.</p>
          </div>`,
        }),
      });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
