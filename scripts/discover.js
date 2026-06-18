#!/usr/bin/env node
/**
 * Daily content discovery — runs in GitHub Actions, no API key needed.
 * Scrapes multiple sources: Reddit, arXiv, RSS feeds from key sites.
 * Writes candidates to data/pending.json.
 *
 * Content scope: anything that illuminates direct experience.
 * Personal accounts, teacher talks, research papers, ancient texts,
 * modern commentary, scientific investigation. No guard rails on form.
 * The only filter: does it add real value?
 */

const fs = require('fs');
const path = require('path');

// Reddit sources
const REDDIT_SOURCES = [
  { sub: 'streamentry', minScore: 20 },
  { sub: 'awakened', minScore: 15 },
  { sub: 'kundalini', minScore: 10 },
  { sub: 'NDE', minScore: 15 },
  { sub: 'dzogchen', minScore: 8 },
  { sub: 'consciousness', minScore: 30 },
  { sub: 'Psychonaut', minScore: 40 },
  { sub: 'RationalPsychonaut', minScore: 30 },
];

// RSS / Atom feeds from quality sources
const RSS_SOURCES = [
  'https://scholar.google.com/scholar_alerts?hl=en&as_q=mystical+experience+phenomenology&num=5&as_occt=any&as_sdt=1%2C5&as_sdtp=',
  'https://export.arxiv.org/rss/q-bio.NC', // neuroscience of consciousness
];

// Quality keywords — things that suggest real content
const QUALITY_SIGNALS = [
  'felt', 'noticed', 'happened', 'experienced', 'dissolved', 'disappeared',
  'suddenly', 'awareness', 'consciousness', 'self', 'moment', 'ceased',
  'empty', 'open', 'vast', 'still', 'silent', 'boundary', 'presence',
  'energy', 'light', 'unity', 'infinite', 'timeless', 'no thought',
  'realization', 'recognition', 'seeing', 'knowing', 'being',
];

// What to skip
const SKIP_SIGNALS = [
  'can anyone recommend', 'looking for advice', 'should i',
  'book recommendation', 'which teacher', 'how do i get',
  'moderator', 'removed', 'deleted',
];

const TAG_MAP = {
  jhana: ['jhana', 'absorption', 'samadhi', 'piti', 'sukha', 'cessation', 'access concentration'],
  nondual: ['nondual', 'non-dual', 'rigpa', 'turiya', 'satori', 'kensho', 'no self', 'no-self', 'advaita', 'dzogchen', 'rigpa'],
  kundalini: ['kundalini', 'shakti', 'kriyas', 'kriya', 'energy rising', 'spine', 'chakra'],
  'ego-dissolution': ['ego death', 'ego dissolution', 'self dissolved', 'boundaries dissolved', 'no self'],
  'dark-night': ['dark night', 'dryness', 'emptiness', 'dukkha nanas', 'difficult', 'void', 'despair'],
  'nde-type': ['nde', 'near death', 'out of body', 'obe', 'life review', 'tunnel'],
  spontaneous: ['spontaneous', 'unexpected', 'without warning', 'out of nowhere'],
  psychedelic: ['psilocybin', 'mushroom', 'dmt', 'ayahuasca', 'lsd', 'psychedelic', 'plant medicine'],
  'cross-tradition': ['christian', 'sufi', 'kabbalah', 'vedanta', 'taoism', 'zen', 'tibetan', 'theravada', 'comparative'],
  research: ['study', 'research', 'paper', 'journal', 'experiment', 'data', 'findings', 'participants'],
  teaching: ['buddha', 'osho', 'watts', 'krishnamurti', 'ramana', 'mckenna', 'nisargadatta', 'adyashanti', 'tolle', 'rumi', 'hafiz'],
};

async function fetchReddit(sub, minScore) {
  const url = `https://www.reddit.com/r/${sub}/top.json?t=week&limit=25`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'directexperience-bot/1.0 (content curation)' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data?.children || [])
      .map(c => c.data)
      .filter(p =>
        p.score >= minScore &&
        p.selftext &&
        p.selftext.length > 300 &&
        !p.selftext.includes('[removed]') &&
        !p.selftext.includes('[deleted]')
      );
  } catch {
    return [];
  }
}

async function fetchArxiv() {
  // Search arXiv for recent papers on consciousness/mystical experience
  const queries = [
    'mystical experience neuroscience',
    'psilocybin mystical consciousness',
    'meditation altered states phenomenology',
    'near death experience consciousness',
  ];
  const results = [];
  const dayIndex = Math.floor(Date.now() / 86400000) % queries.length;
  const query = encodeURIComponent(queries[dayIndex]);

  try {
    const url = `https://export.arxiv.org/api/query?search_query=all:${query}&max_results=5&sortBy=submittedDate&sortOrder=descending`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const text = await res.text();

    // Parse arXiv Atom feed
    const entries = text.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
    for (const entry of entries) {
      const title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/<[^>]+>/g, '').trim();
      const summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.replace(/<[^>]+>/g, '').trim();
      const link = (entry.match(/href="(https:\/\/arxiv\.org\/abs\/[^"]+)"/) || [])[1];
      const authors = [...(entry.matchAll(/<name>(.*?)<\/name>/g))].map(m => m[1]).slice(0, 3).join(', ');

      if (title && summary && link) {
        results.push({ title, summary, link, authors });
      }
    }
  } catch {
    // arXiv unavailable today
  }
  return results;
}

function scoreText(title, body) {
  const text = (title + ' ' + body).toLowerCase();
  if (SKIP_SIGNALS.some(s => text.includes(s))) return 0;
  return QUALITY_SIGNALS.filter(k => text.includes(k)).length;
}

function inferTags(title, body) {
  const text = (title + ' ' + body).toLowerCase();
  return Object.entries(TAG_MAP)
    .filter(([, kw]) => kw.some(k => text.includes(k)))
    .map(([tag]) => tag)
    .slice(0, 4);
}

async function main() {
  const postsPath = path.join(__dirname, '../data/posts.json');
  const pendingPath = path.join(__dirname, '../data/pending.json');

  const existing = JSON.parse(fs.readFileSync(postsPath, 'utf-8'));
  const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
  const seenUrls = new Set([...existing.map(p => p.url), ...pending.map(p => p.url)]);

  const candidates = [];

  // --- Reddit ---
  for (const { sub, minScore } of REDDIT_SOURCES) {
    console.log(`r/${sub}...`);
    const posts = await fetchReddit(sub, minScore);
    for (const p of posts) {
      const url = `https://reddit.com${p.permalink}`;
      if (seenUrls.has(url)) continue;
      const score = scoreText(p.title, p.selftext);
      if (score < 3) continue;
      const tags = inferTags(p.title, p.selftext);

      candidates.push({
        id: `reddit-${p.id}`,
        url,
        headline: p.title.replace(/^\[.*?\]\s*/, '').trim(),
        description: p.selftext.replace(/\n+/g, ' ').trim().slice(0, 300) + '...',
        source: 'reddit',
        domain: `r/${sub}`,
        tags,
        quality_score: score,
        upstream_score: p.score,
        status: 'pending',
        date_found: new Date().toISOString(),
        date_posted: null,
        seeded_by: 'automation',
      });
    }
  }

  // --- arXiv research papers ---
  console.log('arXiv...');
  const papers = await fetchArxiv();
  for (const paper of papers) {
    if (seenUrls.has(paper.link)) continue;
    const tags = inferTags(paper.title, paper.summary);
    if (!tags.includes('research')) tags.unshift('research');

    candidates.push({
      id: `arxiv-${paper.link.split('/').pop()}`,
      url: paper.link,
      headline: paper.title,
      description: paper.summary.slice(0, 300) + (paper.summary.length > 300 ? '...' : ''),
      source: 'research',
      domain: 'arxiv.org',
      tags: tags.slice(0, 4),
      quality_score: 5, // research papers get baseline quality score
      upstream_score: 0,
      status: 'pending',
      date_found: new Date().toISOString(),
      date_posted: null,
      seeded_by: 'automation',
    });
  }

  // Sort and take top 8 candidates
  candidates.sort((a, b) => b.quality_score - a.quality_score);
  const top = candidates.slice(0, 8);

  if (top.length === 0) {
    console.log('No new candidates today.');
    return;
  }

  const updatedPending = [...pending, ...top];
  fs.writeFileSync(pendingPath, JSON.stringify(updatedPending, null, 2));
  console.log(`\nAdded ${top.length} candidates to pending:`);
  top.forEach((p, i) => console.log(`  ${i + 1}. [${p.domain}] ${p.headline.slice(0, 80)}`));
}

main().catch(err => { console.error(err); process.exit(1); });
