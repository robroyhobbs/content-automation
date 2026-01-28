#!/bin/bash
#
# Content Automation Hub - Linux Setup Script
# Run this on a fresh Linux machine (Ubuntu/Debian) to set up the full automation hub
#

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  Content Automation Hub - Linux Setup"
echo "═══════════════════════════════════════════════════════════════"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
INSTALL_DIR="${INSTALL_DIR:-$HOME/automation}"
HUB_REPO="https://github.com/robroyhobbs/content-automation.git"
DOCSMITH_REPO="https://github.com/robroyhobbs/docsmith-daily.git"
NODE_VERSION="20"

echo ""
echo "Install directory: $INSTALL_DIR"
echo ""

# Step 1: Install system dependencies
echo -e "\n${GREEN}[1/8] Installing system dependencies...${NC}"
if command -v apt-get &> /dev/null; then
  sudo apt-get update
  sudo apt-get install -y curl git build-essential
elif command -v yum &> /dev/null; then
  sudo yum install -y curl git gcc-c++ make
elif command -v dnf &> /dev/null; then
  sudo dnf install -y curl git gcc-c++ make
else
  echo -e "${RED}Unsupported package manager. Install curl, git, and build tools manually.${NC}"
  exit 1
fi

# Step 2: Install Node.js via nvm
echo -e "\n${GREEN}[2/8] Installing Node.js v${NODE_VERSION}...${NC}"
if ! command -v node &> /dev/null; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm install $NODE_VERSION
  nvm use $NODE_VERSION
  nvm alias default $NODE_VERSION
else
  echo "Node.js already installed: $(node --version)"
fi

# Step 3: Install Claude CLI
echo -e "\n${GREEN}[3/8] Installing Claude CLI...${NC}"
if ! command -v claude &> /dev/null; then
  npm install -g @anthropic-ai/claude-code
  echo ""
  echo -e "${YELLOW}IMPORTANT: You need to authenticate Claude CLI.${NC}"
  echo "Run 'claude' and follow the prompts to log in."
  echo ""
else
  echo "Claude CLI already installed"
fi

# Step 4: Create directory structure
echo -e "\n${GREEN}[4/8] Creating directory structure...${NC}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Step 5: Clone repositories
echo -e "\n${GREEN}[5/8] Cloning repositories...${NC}"

# Content Automation Hub
if [ ! -d "content-automation" ]; then
  git clone "$HUB_REPO" content-automation
else
  echo "content-automation already exists, pulling latest..."
  cd content-automation && git pull && cd ..
fi

# DocSmith (used by hub's docsmith task)
if [ ! -d "docsmith-daily" ]; then
  git clone "$DOCSMITH_REPO" docsmith-daily
else
  echo "docsmith-daily already exists, pulling latest..."
  cd docsmith-daily && git pull && cd ..
fi

# Step 6: Install npm dependencies
echo -e "\n${GREEN}[6/8] Installing npm dependencies...${NC}"
cd "$INSTALL_DIR/content-automation"
npm install

cd "$INSTALL_DIR/docsmith-daily"
npm install

# Step 7: Create wrapper scripts and cron jobs
echo -e "\n${GREEN}[7/8] Setting up cron jobs...${NC}"

# Main hub runner script
cat > "$INSTALL_DIR/run-hub.sh" << 'WRAPPER'
#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"

cd "$HOME/automation/content-automation"
node hub/index.mjs >> logs/cron.log 2>&1
WRAPPER
chmod +x "$INSTALL_DIR/run-hub.sh"

# Update docsmith task to point to correct path
cat > "$INSTALL_DIR/content-automation/tasks/docsmith/runner.mjs" << 'RUNNER'
/**
 * DocSmith Task Runner - Wrapper for docsmith-daily automation
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const DOCSMITH_PATH = process.env.DOCSMITH_PATH || join(process.env.HOME, 'automation', 'docsmith-daily');

async function run(context) {
  const { logger } = context;

  logger.info('[docsmith] Starting DocSmith automation', { projectPath: DOCSMITH_PATH });

  if (!existsSync(DOCSMITH_PATH)) {
    return {
      success: false,
      error: `DocSmith project not found at ${DOCSMITH_PATH}`
    };
  }

  return new Promise((resolve) => {
    const child = spawn('node', ['src/index.mjs'], {
      cwd: DOCSMITH_PATH,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });

    child.on('close', (code) => {
      const success = code === 0;
      const urlMatch = output.match(/https:\/\/docsmith\.aigne\.io\/[^\s\n\)]+/);

      logger.info('[docsmith] DocSmith completed', { success, code });

      resolve({
        success,
        output: output.substring(0, 2000),
        url: urlMatch ? urlMatch[0] : null
      });
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        error: error.message
      });
    });
  });
}

export default { run };
RUNNER

# Set up cron jobs for different schedules
# Main hub run at 9 AM
CRON_MAIN="0 9 * * * $INSTALL_DIR/run-hub.sh"

# Remove existing automation crons and add new ones
crontab -l 2>/dev/null | grep -v "run-hub.sh" | grep -v "run-docsmith.sh" > /tmp/crontab.tmp || true
echo "$CRON_MAIN" >> /tmp/crontab.tmp
crontab /tmp/crontab.tmp
rm /tmp/crontab.tmp

echo "Added cron job: Daily at 9 AM"

# Step 8: Set up log rotation
echo -e "\n${GREEN}[8/8] Setting up log rotation...${NC}"
sudo tee /etc/logrotate.d/content-automation > /dev/null << LOGROTATE
$INSTALL_DIR/content-automation/logs/*.log
$INSTALL_DIR/docsmith-daily/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 644 $USER $USER
}
LOGROTATE

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo -e "  ${GREEN}Setup Complete!${NC}"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo -e "${CYAN}Installed:${NC}"
echo "  • Content Automation Hub: $INSTALL_DIR/content-automation"
echo "  • DocSmith Daily:         $INSTALL_DIR/docsmith-daily"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo ""
echo "  1. Authenticate Claude CLI:"
echo "     ${YELLOW}claude${NC}"
echo ""
echo "  2. Test the hub:"
echo "     cd $INSTALL_DIR/content-automation"
echo "     npm run status"
echo "     npm start"
echo ""
echo "  3. View the dashboard:"
echo "     npm run dashboard"
echo ""
echo "  4. Check cron:"
echo "     crontab -l"
echo ""
echo -e "${CYAN}Schedule:${NC}"
echo "  • Hub runs daily at 9:00 AM"
echo "  • Enable more tasks in config/tasks.yaml"
echo ""
