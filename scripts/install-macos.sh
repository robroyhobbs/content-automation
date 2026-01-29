#!/bin/bash
#
# Install Content Automation Hub scheduler on macOS
# Runs the daily-blog task at 10am PST on weekdays
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_NAME="com.robroyhobbs.content-automation.plist"
PLIST_SRC="$SCRIPT_DIR/$PLIST_NAME"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_DIR="$PROJECT_DIR/logs"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Content Automation Hub - macOS Scheduler Install"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Create logs directory
mkdir -p "$LOG_DIR"
echo "✓ Created logs directory: $LOG_DIR"

# Create LaunchAgents directory if needed
mkdir -p "$HOME/Library/LaunchAgents"

# Unload existing if present
if launchctl list | grep -q "com.robroyhobbs.content-automation"; then
    echo "  Unloading existing scheduler..."
    launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

# Copy plist
cp "$PLIST_SRC" "$PLIST_DEST"
echo "✓ Installed plist to: $PLIST_DEST"

# Load the scheduler
launchctl load "$PLIST_DEST"
echo "✓ Loaded scheduler"

# Verify
if launchctl list | grep -q "com.robroyhobbs.content-automation"; then
    echo "✓ Scheduler is running"
else
    echo "✗ Warning: Scheduler may not be running"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  INSTALLED SUCCESSFULLY"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Schedule: Hourly from 6 AM to 8 PM, every day"
echo ""
echo "  The hub will run enabled tasks based on their cooldowns:"
echo "    - daily-blog:    Daily blog post generation"
echo "    - docsmith:      Documentation generation"
echo "    - google-ads-*:  Campaign optimization"
echo ""
echo "  Commands:"
echo "    npm run web               # Web dashboard (localhost:3847)"
echo "    npm run dashboard         # Terminal dashboard"
echo "    npm run reviews           # Check pending reviews"
echo "    npm run status            # View hub status"
echo ""
echo "  To uninstall:"
echo "    launchctl unload ~/Library/LaunchAgents/$PLIST_NAME"
echo "    rm ~/Library/LaunchAgents/$PLIST_NAME"
echo ""
echo "  To test manually:"
echo "    npm start                 # Run all enabled tasks"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
