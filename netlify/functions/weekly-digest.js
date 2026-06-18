/**
 * Scheduled every Monday at 9am UTC.
 * Generates and sends the weekly digest to all subscribers.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getStore } = require('@netlify/blobs');

exports.handler = async () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!apiKey || !resendKey) {
    return { statusCode: 500, body: 'Missing API keys' };
  }

  const client = new Anthropic({ apiKey });

  // Get posts from the last 7 days
  const store = getStore('posts');
  const { blobs } = await store.list();

  const allPosts = await Promise.all(
    blobs.map(async ({ key }) => store.get(key, { type: 'json' }))
  );

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekPosts = allPosts
    .filter(Boolean)
    .filter(p => p.status === 'approved' && new Date(p.date_posted) > oneWeekAgo)
    .sort((a, b) => new Date(b.date_posted) - new Date(a.date_posted))
    .slice(0, 5);

  if (weekPosts.length === 0) {
    return { statusCode: 200, body: 'No posts this week.' };
  }

  // Generate editorial intro via Claude
  const postsContext = weekPosts.map(p =>
    `Headline: ${p.headline}\nDescription: ${p.description}\nTags: ${(p.tags || []).join(', ')}`
  ).join('\n\n');

  const introMessage = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `You are the editor of Direct Experience — a curated platform for profound first-person accounts of contemplative and mystical states. The founding principle is No belief required.

Write a brief editorial intro (3-4 sentences maximum) for this week's digest. The voice is: rigorous, non-woo, grounded, respectful of the mystery without being precious about it. Do not summarize the posts. Write something worth reading on its own — something that gives the reader a sense of what we are doing here and why it matters.

This week's posts:\n\n${postsContext}

Return only the intro text. No subject line, no greeting, no sign-off.`,
    }],
  });

  const intro = introMessage.content[0].text.trim();

  // Get all subscribers
  const subStore = getStore('subscribers');
  const { blobs: subBlobs } = await subStore.list();
  const subscribers = await Promise.all(
    subBlobs.map(async ({ key }) => subStore.get(key, { type: 'json' }))
  );
  const activeSubscribers = subscribers.filter(s => s?.active);

  if (activeSubscribers.length === 0) {
    return { statusCode: 200, body: 'No active subscribers.' };
  }

  // Build email HTML
  const postHTML = weekPosts.map(p => `
    <div style="margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid #1c1c1e;">
      <h3 style="font-size:18px;font-weight:400;color:#f2ece0;margin-bottom:8px;line-height:1.35;">
        <a href="${p.url}" style="color:#f2ece0;text-decoration:none;">${p.headline}</a>
      </h3>
      <p style="font-size:12px;color:#7a6040;font-family:Helvetica,Arial,sans-serif;margin-bottom:12px;">
        ${new URL(p.url).hostname.replace('www.', '')}
      </p>
      <p style="font-size:15px;color:#9a9088;line-height:1.7;margin:0;">${p.description}</p>
    </div>
  `).join('');

  const emailHTML = `
    <div style="max-width:600px;margin:0 auto;background:#09090a;color:#ddd8ce;font-family:Georgia,'Times New Roman',serif;padding:0;">
      <div style="padding:40px 40px 32px;border-bottom:1px solid #1c1c1e;">
        <p style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#7a6040;margin:0 0 12px;">Direct Experience &mdash; Weekly Dispatch</p>
        <p style="font-size:15px;color:#9a9088;line-height:1.75;margin:0;">${intro}</p>
      </div>
      <div style="padding:32px 40px 40px;">
        ${postHTML}
        <div style="padding-top:8px;">
          <p style="font-size:12px;color:#3a3830;font-family:Helvetica,Arial,sans-serif;line-height:1.6;">
            No belief required.<br>
            <a href="https://directexperience.now" style="color:#7a6040;">directexperience.now</a>
            &nbsp;&middot;&nbsp;
            <a href="https://directexperience.now/unsubscribe?email={{email}}" style="color:#3a3830;">Unsubscribe</a>
          </p>
        </div>
      </div>
    </div>
  `;

  // Send to all subscribers
  const sends = activeSubscribers.map(sub =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Direct Experience <dispatch@directexperience.now>',
        to: [sub.email],
        subject: `Thus have I heard — ${weekPosts[0].headline.slice(0, 50)}`,
        html: emailHTML.replace('{{email}}', encodeURIComponent(sub.email)),
      }),
    })
  );

  await Promise.all(sends);

  return {
    statusCode: 200,
    body: JSON.stringify({ sent: activeSubscribers.length, posts: weekPosts.length }),
  };
};
