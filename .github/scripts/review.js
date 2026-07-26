'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const PR_NUMBER = process.env.PR_NUMBER;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const MODEL = 'claude-sonnet-4-6';
const GITHUB_API_BASE = 'https://api.github.com';

// ─── GitHub API helpers ───────────────────────────────────────────────────────

async function githubGet(path) {
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub GET ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function githubPost(path, body) {
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`GitHub POST ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// ─── Diff patch parser ────────────────────────────────────────────────────────

/**
 * Parse a unified diff patch string and return a Set of new-file line numbers
 * that are valid comment targets (present in the diff, side: RIGHT).
 *
 * Unified diff format:
 *   @@ -oldStart[,oldCount] +newStart[,newCount] @@ [context]
 *   ' ' context line  → in new file, increment new line counter
 *   '+' added line    → in new file, increment new line counter
 *   '-' deleted line  → not in new file, do NOT increment new line counter
 *   '\' no-newline    → metadata line, skip
 */
function parseValidLines(patch) {
  const validLines = new Set();
  if (!patch) return validLines;

  const lines = patch.split('\n');
  let newLineNumber = 0;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLineNumber = parseInt(hunkMatch[1], 10);
      continue; // hunk header is not a commentable line
    }

    if (line.startsWith('+')) {
      validLines.add(newLineNumber);
      newLineNumber++;
    } else if (line.startsWith(' ')) {
      validLines.add(newLineNumber);
      newLineNumber++;
    } else if (line.startsWith('-')) {
      // deleted line: not present in new file, do not advance new line counter
    }
    // Lines starting with '\' are "No newline at end of file" — skip
  }

  return validLines;
}

// ─── Claude prompt ────────────────────────────────────────────────────────────

function buildPrompt(files) {
  const diffText = files
    .map(f => {
      const header = `File: ${f.filename} (status: ${f.status})`;
      const patch = f.patch || '(binary or no textual diff)';
      return `${header}\n\`\`\`diff\n${patch}\n\`\`\``;
    })
    .join('\n\n');

  return `You are an expert code reviewer for a Node.js Express REST API that stores data in JSON files (no database).

Review the following pull request diff for issues in these categories:
1. **Code quality & best practices** — CommonJS patterns, Express 4.x idioms, error handling, input validation
2. **Security** — injection, path traversal on JSON file reads/writes, unvalidated user input, sensitive data exposure
3. **Test coverage gaps** — untested logic paths visible in the diff (the project has no test framework yet; note what should be tested)
4. **Performance** — synchronous fs calls blocking the event loop, redundant reads, missing de-duplication

Rules:
- Only comment on lines that appear in the diff (added or context lines in the patch)
- Be specific: quote the code and explain the issue
- Prioritize: security > correctness > performance > style
- If there are no issues, return an empty "comments" array

Respond with ONLY valid JSON (no markdown fences, no text outside the JSON):
{
  "comments": [
    {
      "path": "relative/path/to/file.js",
      "line": <new file line number as integer>,
      "body": "Markdown-formatted comment body."
    }
  ],
  "summary": "One-paragraph plain-text summary of the overall review."
}

Pull Request Diff:
${diffText}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set');
  if (!PR_NUMBER || !REPO_OWNER || !REPO_NAME) {
    throw new Error('PR_NUMBER, REPO_OWNER, or REPO_NAME environment variable is missing');
  }

  // 1. Fetch PR file list with patches
  console.log(`Fetching diff for PR #${PR_NUMBER} in ${REPO_OWNER}/${REPO_NAME} ...`);
  const files = await githubGet(
    `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/files`
  );

  const reviewableFiles = files.filter(f => f.patch);
  if (reviewableFiles.length === 0) {
    console.log('No files with textual patches found. Nothing to review.');
    process.exit(0);
  }

  console.log(`Reviewing ${reviewableFiles.length} file(s) ...`);

  // 2. Build per-file valid-line sets
  const validLinesByFile = {};
  for (const f of reviewableFiles) {
    validLinesByFile[f.filename] = parseValidLines(f.patch);
  }

  // 3. Send diff to Claude
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const prompt = buildPrompt(reviewableFiles);

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = message.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('Claude returned no text block in response');

  // 4. Parse Claude's JSON output
  let review;
  try {
    // Claude may occasionally wrap output in markdown fences despite the instruction.
    // Strip them defensively before parsing.
    const rawText = textBlock.text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    review = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`Failed to parse Claude response as JSON.\nRaw output:\n${textBlock.text}`);
  }

  const { comments = [], summary = 'AI code review complete.' } = review;

  // 5. Validate comments against actual diff positions
  const validatedComments = [];
  for (const c of comments) {
    if (!c.path || typeof c.line !== 'number' || !c.body) {
      console.warn(`Skipping malformed comment: ${JSON.stringify(c)}`);
      continue;
    }
    const validLines = validLinesByFile[c.path];
    if (!validLines) {
      console.warn(`Skipping comment on unlisted file "${c.path}"`);
      continue;
    }
    if (!validLines.has(c.line)) {
      console.warn(`Skipping comment on line ${c.line} of "${c.path}" — not in diff`);
      continue;
    }
    validatedComments.push({
      path: c.path,
      line: c.line,
      side: 'RIGHT',
      body: c.body,
    });
  }

  // 6. Post PR review to GitHub
  //    Use APPROVE only when there are no comments (no issues found)
  const reviewEvent = validatedComments.length === 0 ? 'APPROVE' : 'COMMENT';

  await githubPost(
    `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/reviews`,
    {
      body: summary,
      event: reviewEvent,
      comments: validatedComments,
    }
  );

  console.log(
    `✓ Review posted as ${reviewEvent} with ${validatedComments.length} inline comment(s).`
  );
}

main().catch(err => {
  console.error('PR review agent error:', err.message);
  process.exit(1);
});
