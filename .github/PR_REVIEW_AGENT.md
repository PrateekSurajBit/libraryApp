# PR Review Agent — How It Works

This document explains how the automated PR review agent was built and how it operates.

---

## What is the PR Review Agent?

The PR review agent is a **GitHub Action** that automatically reviews pull requests when they're created or updated. It uses Claude (Anthropic's AI) to analyze code changes and post inline comments on specific lines of code, covering:

- **Code Quality & Best Practices** — coding patterns, error handling, input validation
- **Security Issues** — injection risks, path traversal, unvalidated inputs
- **Test Coverage Gaps** — untested code paths that should have tests
- **Performance Concerns** — synchronous I/O blocking, redundant reads, inefficiencies

---

## Architecture Overview

The system has three main components:

### 1. **GitHub Actions Workflow** (`.github/workflows/pr-review.yml`)
- **Trigger**: Runs automatically when a PR is opened, updated, or reopened
- **Steps**:
  1. Check out the repository code
  2. Set up Node.js 20
  3. Install npm dependencies (`@anthropic-ai/sdk`)
  4. Run the review script with environment variables (PR number, repo info, API keys)

### 2. **Review Script** (`.github/scripts/review.js`)
- **Main Logic**:
  - Fetches the PR's diff from GitHub API
  - Parses the unified diff format to identify valid line numbers
  - Sends the code changes to Claude for review
  - Validates Claude's response and posts inline comments back to GitHub

### 3. **Dependencies** (`.github/scripts/package.json`)
- Only one dependency: `@anthropic-ai/sdk` (for calling Claude's API)
- GitHub API calls use Node.js's built-in `fetch` (no extra packages needed)

---

## How It Works — Step by Step

### Step 1: PR Event Triggers Workflow
When you open or update a PR on GitHub, the workflow defined in `.github/workflows/pr-review.yml` is automatically triggered.

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
```

### Step 2: Fetch the Diff
The review script uses GitHub's REST API to fetch all changed files:

```
GET /repos/{owner}/{repo}/pulls/{number}/files
```

This returns metadata for each file including a `patch` field containing the **unified diff** (the `+` and `-` lines showing what changed).

Example response for a file:
```json
{
  "filename": "src/controllers/booksController.js",
  "status": "modified",
  "patch": "@@ -1,5 +1,6 @@\n const { readData, writeData } = require('../utils/fileStore');\n+const validator = require('validator');\n ..."
}
```

### Step 3: Parse Valid Line Numbers
The script parses each file's unified diff to identify which line numbers in the **new file** are valid for commenting.

**Unified Diff Format:**
```
@@ -oldStart,oldCount +newStart,newCount @@
 context line (unchanged, in both old and new)
+added line (only in new)
-deleted line (only in old)
```

The parser tracks the **new file line number** by:
- Starting at the `newStart` value from the `@@` header
- Incrementing for each context line (` `) and added line (`+`)
- NOT incrementing for deleted lines (`-`)

Result: A `Set<number>` per file containing valid comment positions.

Example: If a file has changes at lines 15-20 in the diff, the valid line set might be `{ 15, 16, 17, 18, 19, 20 }`.

### Step 4: Build Claude Prompt
All file diffs are combined into a structured prompt sent to Claude:

```
You are an expert code reviewer for a Node.js Express REST API...

Review the following PR diff for:
1. Code quality & best practices
2. Security issues
3. Test coverage gaps
4. Performance

Only comment on lines that appear in the diff. Respond with ONLY valid JSON...
```

The prompt includes the actual `patch` text from each file so Claude can see exactly what changed.

### Step 5: Call Claude API
The script uses the Anthropic SDK to call `claude-sonnet-4-6`:

```javascript
const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const message = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  messages: [{ role: 'user', content: prompt }],
});
```

Claude responds with structured JSON containing:
```json
{
  "comments": [
    {
      "path": "src/controllers/booksController.js",
      "line": 42,
      "body": "**Security**: Input validation missing on isbn parameter."
    }
  ],
  "summary": "Overall review summary paragraph."
}
```

### Step 6: Validate Comments
Before posting to GitHub, the script validates each comment:
- ✅ Does the file path exist in the PR's file list?
- ✅ Is the line number in the file's valid-line set?

This prevents GitHub API errors from invalid comment positions.

### Step 7: Post PR Review
The script uses GitHub's Pull Request Reviews API to post the feedback:

```
POST /repos/{owner}/{repo}/pulls/{number}/reviews
```

With body:
```json
{
  "body": "Overall summary paragraph",
  "event": "COMMENT",
  "comments": [
    {
      "path": "src/controllers/booksController.js",
      "line": 42,
      "side": "RIGHT",
      "body": "Security issue: input validation missing."
    }
  ]
}
```

The `side: "RIGHT"` indicates we're commenting on the **new file version** (not the old one).

**Review Event Types:**
- `COMMENT` — Post comments without blocking the PR (used when issues found)
- `APPROVE` — Give a thumbs-up (used when no issues found, empty comments array)
- `REQUEST_CHANGES` — Block the PR until changes are made (not used here to avoid false positives)

---

## Key Technical Decisions

### Why parse the unified diff instead of reading files?

The PR diff is already available from the GitHub API, and parsing it tells us exactly which line numbers in the new file are safe to comment on. This avoids:
- Race conditions (files might change between fetching diff and reading them)
- Unnecessary GitHub API calls to fetch file contents
- Edge cases with renamed files or binary diffs

### Why use `side: "RIGHT"` for comments?

`side: "RIGHT"` means we're commenting on the new file version (the "right" side of a diff view). Alternatives like `position` (1-indexed position in the raw diff) are harder to work with because they count `@@` headers and deleted lines, whereas Claude naturally reasons about file line numbers.

### Why validate Claude's comments?

Claude is powerful but not infallible. It might suggest comments on lines that:
- Don't actually exist in the diff (hallucination)
- Are in files that weren't changed
- Are outside the valid line range

Validating prevents GitHub API errors and ensures the feedback is always accurate.

### Why use `COMMENT` instead of `REQUEST_CHANGES`?

`REQUEST_CHANGES` blocks the PR merge until a reviewer dismisses the review. For an automated tool, this is too strict — even with careful prompting, Claude might flag things that aren't actually issues. Using `COMMENT` provides feedback without blocking, letting the developer decide.

### Why only one npm dependency?

Keeping dependencies minimal reduces:
- Installation time (every PR triggers `npm install`)
- Security attack surface
- Maintenance burden

GitHub API calls use Node.js 20's built-in `fetch` (available without imports since Node 18). The Anthropic SDK is the only real dependency.

---

## Setup Instructions

### 1. Add API Key Secret

Go to **GitHub Settings → Secrets and variables → Actions** and add:

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (`sk-ant-api03-...`) |

Get a key from https://console.anthropic.com/account/keys

### 2. Create a Test PR

1. Create a new branch: `git checkout -b test-pr-review`
2. Make a code change to any file in `src/`
3. Commit and push: `git push origin test-pr-review`
4. Open a PR on GitHub
5. Watch the "Checks" section — the "AI Code Review" action will run
6. Click "Files changed" to see inline comments

---

## Example: What Does the Agent Review?

### Example 1: Security Issue
If the PR adds code without input validation:
```javascript
app.post('/api/books', (req, res) => {
  const { title, author } = req.body;  // No validation
  // ...
});
```

Claude might comment:
> **Security**: `title` and `author` are used without validation. Consider checking for empty strings, length limits, or special characters before storing.

### Example 2: Test Coverage Gap
If a PR adds a new function but doesn't add tests:
```javascript
const deleteBook = (req, res) => {
  // ...logic...
};
```

Claude might comment:
> **Test Coverage**: The `deleteBook` controller handles multiple cases (not found, book assigned, successful delete). Consider adding tests for all three paths.

### Example 3: Performance Issue
If a PR uses synchronous I/O in a loop:
```javascript
for (const book of books) {
  const data = readData('books.json');  // Called N times
}
```

Claude might comment:
> **Performance**: `readData` is called inside a loop. Read the file once before the loop and reuse the data.

---

## Limitations and Future Improvements

### Current Limitations
1. **No test framework** — The agent can identify untested code but doesn't run tests
2. **No linter** — Some style issues aren't caught (would need ESLint)
3. **Single file context** — Claude sees only the diff, not the full codebase
4. **Token limits** — Very large PRs (100+ files) might exceed Claude's input limit

### Potential Improvements
1. Add the full file content alongside the diff for better context
2. Integrate with ESLint to catch style issues automatically
3. Add a configuration file (`.prreviewrc.json`) to customize which categories to review
4. Cache file reads to avoid repeated API calls for large PRs
5. Support `REQUEST_CHANGES` for high-severity security findings

---

## Debugging

### Check the Action Logs
1. Go to your PR's **Checks** section
2. Click **"AI Code Review"** → **Details**
3. Scroll to see the script's output, including:
   - Number of files reviewed
   - Number of comments posted
   - Any errors

### Common Issues

**"ANTHROPIC_API_KEY is not set"**
- Verify the secret is added to your repo settings
- Make sure the name is exactly `ANTHROPIC_API_KEY`

**"GitHub GET failed: 401"**
- `GITHUB_TOKEN` is missing (shouldn't happen — it's auto-injected)
- Check that your Actions permissions include `pull-requests: write`

**"Failed to parse Claude response as JSON"**
- Claude might have returned markdown-wrapped JSON (rare)
- Check the action log to see the raw response

**No comments posted (but action succeeded)**
- The diff might have no reviewable files (only `.gitignore`, README, etc.)
- Claude found no issues (which is good!)
- Check the summary comment on the PR

---

## Architecture Diagram

```
┌─────────────────────┐
│  You create/update  │
│  a Pull Request     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  GitHub Actions Workflow Triggered      │
│  (pr-review.yml)                        │
└──────────┬──────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  1. Fetch PR diff via GitHub API        │
│  GET /repos/.../pulls/{number}/files    │
└──────────┬──────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  2. Parse unified diff patches          │
│  Build valid-line sets per file         │
└──────────┬──────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  3. Call Claude API                     │
│  Send prompt with diff + instructions   │
└──────────┬──────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  4. Parse Claude's JSON response        │
│  Extract comments + summary             │
└──────────┬──────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  5. Validate comments                   │
│  Check file paths + line numbers        │
└──────────┬──────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  6. Post PR Review to GitHub            │
│  POST /repos/.../pulls/{number}/reviews │
└──────────┬──────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  Inline comments appear on PR            │
│  "Files changed" tab                    │
└─────────────────────────────────────────┘
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `.github/workflows/pr-review.yml` | GitHub Actions workflow definition |
| `.github/scripts/review.js` | Main review agent script (272 lines) |
| `.github/scripts/package.json` | npm dependencies (`@anthropic-ai/sdk`) |
| `.github/PR_REVIEW_AGENT.md` | This documentation file |

---

## Questions?

For issues or ideas, check:
- **GitHub Actions logs** — see what the agent actually did
- **Anthropic docs** — https://docs.anthropic.com
- **GitHub API docs** — https://docs.github.com/en/rest

Enjoy automated code reviews! 🚀
