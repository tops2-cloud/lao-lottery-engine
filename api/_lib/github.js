// Minimal GitHub REST client for the Vercel API: read the current tree, fetch blobs,
// and write several files as one commit. Needs GITHUB_TOKEN (fine-grained, this repo
// only, Contents: read and write) and GITHUB_REPO (owner/name).
'use strict';

const crypto = require('crypto');

const API = 'https://api.github.com';

function cfg() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'tops2-cloud/lao-lottery-engine';
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token) { const e = new Error('ยังไม่ได้ตั้งค่า GITHUB_TOKEN ใน Vercel'); e.code = 'NO_TOKEN'; throw e; }
  return { token, repo, branch };
}

async function gh(method, path, body) {
  const { token } = cfg();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'lao-lottery-engine-app',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = new Error(`GitHub ${method} ${path} → ${res.status} ${data?.message || ''}`.trim());
    e.status = res.status;
    if (res.status === 401 || res.status === 403) e.code = 'BAD_TOKEN';
    throw e;
  }
  return data;
}

async function head() {
  const { repo, branch } = cfg();
  const ref = await gh('GET', `/repos/${repo}/git/ref/heads/${branch}`);
  const commit = await gh('GET', `/repos/${repo}/git/commits/${ref.object.sha}`);
  return { sha: ref.object.sha, tree: commit.tree.sha };
}

async function tree(treeSha) {
  const { repo } = cfg();
  const t = await gh('GET', `/repos/${repo}/git/trees/${treeSha}?recursive=1`);
  if (t.truncated) throw new Error('GitHub tree truncated');
  return t.tree.filter((e) => e.type === 'blob');
}

async function blob(sha) {
  const { repo } = cfg();
  const b = await gh('GET', `/repos/${repo}/git/blobs/${sha}`);
  return Buffer.from(b.content, b.encoding === 'base64' ? 'base64' : 'utf8');
}

// Same id git gives a file's contents, so unchanged files are never downloaded.
function blobSha(buf) {
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

// files: [{ path, content }] — one commit on top of parentSha. Fails (422) if the
// branch moved meanwhile, so the caller can re-sync and retry.
async function commitFiles(parentSha, baseTree, files, message) {
  const { repo, branch } = cfg();
  const t = await gh('POST', `/repos/${repo}/git/trees`, {
    base_tree: baseTree,
    tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
  });
  const c = await gh('POST', `/repos/${repo}/git/commits`, {
    message,
    tree: t.sha,
    parents: [parentSha],
    author: { name: 'lao-lottery-app', email: 'actions@users.noreply.github.com' },
  });
  await gh('PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: c.sha, force: false });
  return c.sha;
}

module.exports = { head, tree, blob, blobSha, commitFiles, cfg };
