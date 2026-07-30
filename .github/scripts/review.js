// ─────────────────────────────────────────────────────────────────────────────
// AI Code Review Script for GitHub Actions
//
// This script:
// 1. Fetches the PR's code diff from GitHub API
// 2. Sends it to Claude for analysis
// 3. Parses Claude's response
// 4. Posts inline PR review comments back to GitHub
//
// Triggered by: GitHub Actions workflow when PR is opened/updated/reopened
// ─────────────────────────────────────────────────────────────────────────────

'use strict';  // enforce strict mode (safer JavaScript, catches common errors)

// Import the Anthropic SDK (installed via npm install)
const Anthropic = require('@anthropic-ai/sdk');

// ─────────────────────────────────────────────────────────────────────────────
// Environment Variables (passed from the GitHub Actions workflow)
// ─────────────────────────────────────────────────────────────────────────────

// Anthropic API key (stored in GitHub Secrets, never logged)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// GitHub token for API authentication (auto-injected by GitHub Actions)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// PR number from the webhook event (e.g., 123)
const PR_NUMBER = process.env.PR_NUMBER;
// Repository owner username (e.g., "PrateekSurajBit")
const REPO_OWNER = process.env.REPO_OWNER;
// Repository name (e.g., "libraryApp")
const REPO_NAME = process.env.REPO_NAME;
// Claude model to use for the review (Sonnet is fast + accurate)
const MODEL = 'claude-sonnet-4-6';
// Base URL for GitHub REST API
const GITHUB_API_BASE = 'https://api.github.com';

// ─────────────────────────────────────────────────────────────────────────────
// GitHub API Helpers
//
// Utility functions to make authenticated requests to the GitHub REST API.
// Uses Node.js built-in fetch (no extra npm packages needed).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make an authenticated GET request to the GitHub API
 * @param {string} path - API endpoint path (e.g., /repos/owner/repo/pulls/123)
 * @returns {Promise<object>} parsed JSON response
 */
async function githubGet(path) {
  // Construct the full URL by combining base URL + path
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      // Bearer token for authentication (GitHub Actions auto-injects GITHUB_TOKEN)
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      // Tell GitHub API we accept JSON responses
      Accept: 'application/vnd.github+json',
      // Specify GitHub API version to use
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  // If the request failed (status not 2xx), throw an error with details
  if (!res.ok) {
    throw new Error(`GitHub GET ${path} failed: ${res.status} ${await res.text()}`);
  }
  // Parse and return the JSON response body
  return res.json();
}

/**
 * Make an authenticated POST request to the GitHub API
 * @param {string} path - API endpoint path
 * @param {object} body - request body (will be JSON-stringified)
 * @returns {Promise<object>} parsed JSON response
 */
async function githubPost(path, body) {
  // Construct the full URL
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    // Specify POST method
    method: 'POST',
    headers: {
      // Bearer token for authentication
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      // Accept JSON responses
      Accept: 'application/vnd.github+json',
      // Specify GitHub API version
      'X-GitHub-Api-Version': '2022-11-28',
      // Tell server we're sending JSON data
      'Content-Type': 'application/json',
    },
    // Convert the body object to a JSON string
    body: JSON.stringify(body),
  });
  // If the request failed, throw an error with details
  if (!res.ok) {
    throw new Error(`GitHub POST ${path} failed: ${res.status} ${await res.text()}`);
  }
  // Parse and return the JSON response body
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Diff Parser
//
// Parses a unified diff (the format used by `git diff`) to identify which line
// numbers in the NEW file are safe to comment on. GitHub only allows comments
// on lines that appear in the diff, so this function validates comment positions.
//
// Unified diff format example:
//   @@ -oldStart,oldCount +newStart,newCount @@ context
//   ' ' = context line (unchanged, in both old and new files)
//   '+' = added line (only in new file)
//   '-' = deleted line (only in old file)
//   '\' = metadata (no newline at EOF)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a unified diff patch and return a Set of commentable line numbers.
 *
 * @param {string} patch - unified diff patch string
 * @returns {Set<number>} set of line numbers (in the new file) where comments can be posted
 *
 * Algorithm:
 * 1. Find hunk headers (@@ -old +new @@) to get the starting line number
 * 2. Iterate through each line in the hunk
 * 3. For '+' and ' ' lines (present in new file), add line number to the set
 * 4. For '-' lines (deleted, not in new file), skip (don't add, don't increment counter)
 */
function parseValidLines(patch) {
  // Set stores unique line numbers; Set prevents duplicates automatically
  const validLines = new Set();
  // If patch is null/empty, return an empty set (no commentable lines)
  if (!patch) return validLines;

  // Split patch into individual lines (includes hunk headers and diff markers)
  const lines = patch.split('\n');
  // Track the current line number in the NEW file as we iterate through the patch
  let newLineNumber = 0;

  // Iterate through every line in the patch
  for (const line of lines) {
    // Try to match a hunk header: @@ -oldStart[,oldCount] +newStart[,newCount] @@
    // The regex captures the newStart line number (group 1)
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      // Hunk header found; extract and set the starting line number in the new file
      newLineNumber = parseInt(hunkMatch[1], 10);
      continue; // Skip to next line (hunk headers themselves aren't commentable)
    }

    // Line starts with '+': added line (present in new file)
    if (line.startsWith('+')) {
      // Add the current line number to the set of valid comment targets
      validLines.add(newLineNumber);
      // Move to the next line number in the new file
      newLineNumber++;
    }
    // Line starts with ' ' (space): context line (unchanged, in both files)
    else if (line.startsWith(' ')) {
      // Context lines are also commentable
      validLines.add(newLineNumber);
      // Move to the next line number in the new file
      newLineNumber++;
    }
    // Line starts with '-': deleted line (not in new file)
    else if (line.startsWith('-')) {
      // Deleted lines don't exist in the new file, so don't add and don't increment
      // (the line counter stays the same; the next line's number is unchanged)
    }
    // Lines starting with '\' are metadata ("\ No newline at end of file")
    // These are skipped silently (no special handling needed)
  }

  // Return the set of all line numbers where comments can be posted
  return validLines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Prompt Builder
//
// Constructs the prompt that will be sent to Claude for code review.
// Includes:
// - Context about the project (Node.js + Express + JSON storage)
// - Review categories and priorities (security > correctness > performance > style)
// - Output format requirements (JSON with specific structure)
// - The actual code diff for Claude to analyze
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the prompt to send to Claude for PR review
 *
 * @param {object[]} files - array of files from GitHub PR API (includes filename, status, patch)
 * @returns {string} the complete prompt to send to Claude
 */
function buildPrompt(files) {
  // Format each file's diff as a markdown code block for readability
  const diffText = files
    .map(f => {
      // Create a header line with filename and change status (added, modified, deleted, etc.)
      const header = `File: ${f.filename} (status: ${f.status})`;
      // Get the patch (unified diff); use placeholder text if no patch (binary files, etc.)
      const patch = f.patch || '(binary or no textual diff)';
      // Format the patch in a markdown diff code block for clarity
      return `${header}\n\`\`\`diff\n${patch}\n\`\`\``;
    })
    .join('\n\n');  // Separate multiple files with blank lines

  // Return the complete prompt template
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

CRITICAL: Respond with ONLY valid JSON. Do not include ANY markdown formatting, code blocks, or text outside the JSON object. Output ONLY:
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

// ─────────────────────────────────────────────────────────────────────────────
// Main Entry Point
//
// Orchestrates the entire PR review workflow:
// 1. Validate environment variables
// 2. Fetch PR diff from GitHub
// 3. Parse diff to identify valid comment lines
// 4. Send diff to Claude for analysis
// 5. Validate Claude's response
// 6. Post validated comments back to GitHub
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // ─────────────────────────────────────────────────────────────────────────
  // STEP 0: Validate Environment Variables
  // ─────────────────────────────────────────────────────────────────────────

  // Anthropic API key — must be set in GitHub Secrets (passed by the workflow)
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  // GitHub token — auto-injected by GitHub Actions
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set');
  // PR number, repo owner, repo name — all passed from the workflow
  if (!PR_NUMBER || !REPO_OWNER || !REPO_NAME) {
    throw new Error('PR_NUMBER, REPO_OWNER, or REPO_NAME environment variable is missing');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Fetch PR File List with Diff Patches
  // ─────────────────────────────────────────────────────────────────────────

  // Log what we're about to do (for GitHub Actions workflow logs)
  console.log(`Fetching diff for PR #${PR_NUMBER} in ${REPO_OWNER}/${REPO_NAME} ...`);
  // Call GitHub API to get all files changed in this PR
  // Each file includes a `patch` field with the unified diff
  const files = await githubGet(
    `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/files`
  );

  // Filter to only files with text patches (exclude binary files, renames without changes, etc.)
  const reviewableFiles = files.filter(f => f.patch);
  // If no reviewable files, exit early (nothing to review)
  if (reviewableFiles.length === 0) {
    console.log('No files with textual patches found. Nothing to review.');
    process.exit(0);  // Exit successfully (not an error)
  }

  console.log(`Reviewing ${reviewableFiles.length} file(s) ...`);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Build Per-File Valid Line Sets
  // ─────────────────────────────────────────────────────────────────────────

  // Map from file path to Set of valid line numbers (where comments can be posted)
  const validLinesByFile = {};
  // For each file, parse its patch to find commentable lines
  for (const f of reviewableFiles) {
    validLinesByFile[f.filename] = parseValidLines(f.patch);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: Send Diff to Claude for Analysis
  // ─────────────────────────────────────────────────────────────────────────

  // Initialize Anthropic SDK client with API key
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  // Build the review prompt (includes context, review criteria, and the diff)
  const prompt = buildPrompt(reviewableFiles);

  // Call Claude API with the prompt
  const message = await client.messages.create({
    model: MODEL,  // claude-sonnet-4-6
    max_tokens: 4096,  // allow Claude to generate up to 4KB of output
    system: 'You are a code review bot. You MUST respond with ONLY a valid JSON object. No markdown, no fences, no explanation text. Just the JSON.',
    messages: [{ role: 'user', content: prompt }],
  });

  // Extract the text response from Claude (responses can include multiple content blocks)
  const textBlock = message.content.find(b => b.type === 'text');
  // Fail if Claude didn't return a text response (shouldn't happen)
  if (!textBlock) throw new Error('Claude returned no text block in response');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4: Parse Claude's JSON Output
  // ─────────────────────────────────────────────────────────────────────────

  let review;
  try {
    let rawText = textBlock.text.trim();

    // Try to extract JSON from markdown code blocks if present
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      rawText = jsonMatch[1].trim();
    } else {
      // If no code block found, try stripping loose fences
      rawText = rawText
        .replace(/^```json\s*/i, '')  // remove opening ```json
        .replace(/```\s*$/, '');       // remove closing ```
    }

    // Try to find the first { and last } to extract JSON in case of extra text
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');

    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      rawText = rawText.substring(jsonStart, jsonEnd + 1);
    }

    // Parse the JSON string into an object
    review = JSON.parse(rawText);
  } catch (err) {
    // If parsing fails, show the raw response for debugging
    throw new Error(`Failed to parse Claude response as JSON.\nError: ${err.message}\nRaw output:\n${textBlock.text}`);
  }

  // Extract comments and summary from the parsed response
  // Default to empty comments and generic summary if not provided
  const { comments = [], summary = 'AI code review complete.' } = review;

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 5: Validate Comments Against Actual Diff Positions
  // ─────────────────────────────────────────────────────────────────────────

  // Array to store validated comments that are safe to post to GitHub
  const validatedComments = [];
  // Iterate through each comment Claude suggested
  for (const c of comments) {
    // Check that the comment has required fields (path, line, body)
    if (!c.path || typeof c.line !== 'number' || !c.body) {
      // Log warning and skip malformed comments (prevents GitHub API errors)
      console.warn(`Skipping malformed comment: ${JSON.stringify(c)}`);
      continue;
    }
    // Look up the valid lines set for this file
    const validLines = validLinesByFile[c.path];
    // If the file wasn't in the PR, skip this comment
    if (!validLines) {
      console.warn(`Skipping comment on unlisted file "${c.path}"`);
      continue;
    }
    // If the line number isn't in the valid set, skip this comment
    // (Claude might hallucinate comments on lines that don't exist)
    if (!validLines.has(c.line)) {
      console.warn(`Skipping comment on line ${c.line} of "${c.path}" — not in diff`);
      continue;
    }
    // Comment passed validation; add it to the list with GitHub-specific fields
    validatedComments.push({
      path: c.path,        // relative file path (e.g., src/index.js)
      line: c.line,        // line number in the NEW file
      side: 'RIGHT',       // 'RIGHT' means the new version of the file (not the old one)
      body: c.body,        // markdown-formatted comment text
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 6: Post PR Review to GitHub
  // ─────────────────────────────────────────────────────────────────────────

  // Determine review event type based on whether issues were found
  // APPROVE = no issues; COMMENT = issues found (doesn't block merge)
  // (REQUEST_CHANGES is not used to avoid false positives blocking the PR)
  const reviewEvent = validatedComments.length === 0 ? 'APPROVE' : 'COMMENT';

  // Post the review to GitHub using the PR Reviews API
  await githubPost(
    `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/reviews`,
    {
      body: summary,              // the summary comment text
      event: reviewEvent,         // APPROVE or COMMENT
      comments: validatedComments,  // array of inline comments
    }
  );

  // Log success message (shown in GitHub Actions workflow logs)
  console.log(
    `✓ Review posted as ${reviewEvent} with ${validatedComments.length} inline comment(s).`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Handling & Script Execution
// ─────────────────────────────────────────────────────────────────────────────

// Execute main() and catch any errors (network, API, validation, etc.)
main().catch(err => {
  // Log the error message to GitHub Actions output
  console.error('PR review agent error:', err.message);
  // Exit with error code 1 to mark the action as failed
  process.exit(1);
});
