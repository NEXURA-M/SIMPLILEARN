import { Octokit } from '@octokit/rest';
import fs from 'fs';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const [owner, repo] = process.env.REPO.split('/');

async function fetchAllIssues() {
  const issues = [];
  let page = 1;
  while (true) {
    const { data } = await octokit.rest.issues.listForRepo({
      owner, repo, state: 'all', per_page: 100, page
    });
    if (data.length === 0) break;
    issues.push(...data);
    page++;
  }
  return issues;
}

function tryParsePayload(body) {
  body = (body || '').trim();
  if (!body) return null;
  try {
    const decoded = Buffer.from(body, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  return null;
}

function parseRegister(body, issueNumber, createdAt) {
  const p = tryParsePayload(body);
  if (p && typeof p.name === 'string' && typeof p.whatsapp === 'string') {
    return {
      name: p.name.trim().slice(0, 50),
      whatsapp: String(p.whatsapp).trim().slice(0, 20),
      paidFrom: String(p.paidFrom || '').trim().slice(0, 20),
      amount: Number(p.amount) || 250,
      status: 'unverified',
      issueNumber,
      registeredAt: p.timestamp || createdAt
    };
  }
  // Regex fallback
  const nameMatch = body.match(/\*\*Name:\*\*\s*(.+)/);
  const waMatch = body.match(/\*\*WhatsApp:\*\*\s*(.+)/);
  const fromMatch = body.match(/\*\*Paid From:\*\*\s*(.+)/);
  if (!nameMatch || !waMatch) return null;
  return {
    name: nameMatch[1].trim(),
    whatsapp: waMatch[1].trim(),
    paidFrom: fromMatch ? fromMatch[1].trim() : '',
    amount: 250,
    status: 'unverified',
    issueNumber,
    registeredAt: createdAt
  };
}

async function main() {
  console.log('📡 Fetching register issues from LMO...');
  const issues = await fetchAllIssues();

  // Preserve admin-set status (verified/rejected) across runs
  const existingRegs = fs.existsSync('register.json')
    ? JSON.parse(fs.readFileSync('register.json', 'utf-8'))
    : [];

  const statusMap = new Map();
  existingRegs.forEach(r => {
    if (r.issueNumber && r.status && r.status !== 'unverified') {
      statusMap.set(r.issueNumber, r.status);
    }
  });

  const registerIssues = issues
    .filter(i => i.title.startsWith('[REGISTER]'))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const seen = new Set();
  const registrations = [];

  for (const issue of registerIssues) {
    const parsed = parseRegister(issue.body || '', issue.number, issue.created_at);
    if (!parsed) continue;
    if (seen.has(issue.number)) continue;
    seen.add(issue.number);

    if (statusMap.has(issue.number)) {
      parsed.status = statusMap.get(issue.number);
    }
    registrations.push(parsed);
  }

  fs.writeFileSync('register.json', JSON.stringify(registrations, null, 2));
  console.log(`✅ Synced ${registrations.length} registrations.`);
}

main().catch(err => {
  console.error('❌ Sync failed:', err);
  process.exit(1);
});
