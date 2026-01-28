# Content Automation Hub

A unified platform for automating content creation, distribution, advertising, and research tasks.

## Quick Start

```bash
# Install dependencies
npm install

# Run all enabled tasks
npm start

# View dashboard
npm run dashboard

# Run a specific task
npm run run-task docsmith

# Check status
npm run status
```

## Adding a New Task

### Step 1: Create Task Folder

```bash
cp -r tasks/_template tasks/my-new-task
```

### Step 2: Configure task.yaml

Edit `tasks/my-new-task/task.yaml`:

```yaml
name: my-new-task
description: "What this task does"
category: content-creation  # or distribution, advertising, intelligence
schedule: "0 9 * * *"       # Cron: 9 AM daily
dailyLimit: 3
maxRetries: 2
timeoutMinutes: 30

settings:
  # Your task-specific settings
  apiEndpoint: "https://api.example.com"
```

### Step 3: Implement runner.mjs

Edit `tasks/my-new-task/runner.mjs`:

```javascript
async function run(context) {
  const { config, logger } = context;

  logger.info('Starting my task');

  // Your task logic here
  // - Generate content
  // - Call APIs
  // - Publish results

  return {
    success: true,
    output: 'Task completed',
    url: 'https://example.com/result'
  };
}

export default { run };
```

### Step 4: Register in config/tasks.yaml

Add entry to `config/tasks.yaml`:

```yaml
tasks:
  my-new-task:
    enabled: true
    category: content-creation
    description: "My new automated task"
    schedule: "0 9 * * *"
    dailyLimit: 3
```

### Step 5: Test

```bash
npm run run-task my-new-task
```

## Task Categories

| Category | Description | Examples |
|----------|-------------|----------|
| `content-creation` | Generate new content | DocSmith, Blog, Lead Gen Pages |
| `distribution` | Publish/share content | Social Posts, Reddit, Newsletter |
| `advertising` | Manage paid campaigns | Google Ads |
| `intelligence` | Research & analysis | Trend Research, Competitor Analysis |

## Directory Structure

```
content-automation/
├── hub/
│   ├── index.mjs           # Main orchestrator
│   ├── dashboard/          # Unified dashboard
│   └── shared/             # Shared utilities
├── tasks/
│   ├── _template/          # Copy this for new tasks
│   ├── docsmith/           # Documentation generation
│   ├── daily-blog/         # Blog automation
│   └── ...
├── config/
│   ├── settings.yaml       # Global settings
│   └── tasks.yaml          # Task registry
├── data/                   # Runtime state
├── logs/                   # Log files
└── credentials/            # API keys (gitignored)
```

## Task Runner Interface

Every task must export a `run()` function:

```javascript
async function run(context) {
  // context.taskName   - Name of the task
  // context.config     - Merged configuration
  // context.logger     - Task-specific logger
  // context.state      - Task's current state

  return {
    success: true,        // Required: did it succeed?
    output: 'string',     // Optional: summary
    url: 'https://...',   // Optional: published URL
    error: 'string',      // Optional: error message if failed
    metadata: {}          // Optional: additional data
  };
}
```

## Guardrails

- **Daily limits**: Each task has configurable daily limits
- **Retry limits**: Max 2 retries per task (configurable)
- **Circuit breaker**: Stops if 3 consecutive failures
- **Cooldown**: 1 hour between runs of same task
- **Timeouts**: Configurable per-task timeout

## Scheduling

Tasks are scheduled via cron expressions in `config/tasks.yaml`:

```yaml
schedule: "0 9 * * *"     # 9 AM daily
schedule: "0 8,12,17 * * *"  # 8 AM, 12 PM, 5 PM
schedule: "0 8 * * 1"     # 8 AM every Monday
schedule: "0 6 * * 1,4"   # 6 AM Monday & Thursday
```

## Current Tasks

| Task | Category | Schedule | Status |
|------|----------|----------|--------|
| docsmith | content-creation | 9 AM daily | ✅ Enabled |
| daily-blog | content-creation | 7 AM daily | ⏸ Disabled |
| social-posts | distribution | 8AM/12PM/5PM | ⏸ Disabled |
| reddit | distribution | 11AM/4PM | ⏸ Disabled |
| newsletter | distribution | Fri 8 AM | ⏸ Disabled |
| google-ads | advertising | 6 AM daily | ⏸ Disabled |
| research | intelligence | Mon/Thu 6 AM | ⏸ Disabled |

## License

MIT
