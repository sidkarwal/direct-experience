#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const [,, postId, action] = process.argv;
if (!postId || !['approve', 'reject'].includes(action)) {
  console.error('Usage: node approve.js <post-id> <approve|reject>');
  process.exit(1);
}

const postsPath = path.join(__dirname, '../data/posts.json');
const pendingPath = path.join(__dirname, '../data/pending.json');

const posts = JSON.parse(fs.readFileSync(postsPath, 'utf-8'));
const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));

const idx = pending.findIndex(p => p.id === postId);
if (idx === -1) {
  console.error(`Post ${postId} not found in pending.`);
  process.exit(1);
}

const post = pending[idx];
pending.splice(idx, 1);

if (action === 'approve') {
  post.status = 'approved';
  post.date_posted = new Date().toISOString();
  posts.unshift(post);
  console.log(`Approved: ${post.headline}`);
} else {
  post.status = 'rejected';
  console.log(`Rejected: ${post.headline}`);
}

fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2));
fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2));
