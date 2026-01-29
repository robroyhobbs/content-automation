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
echo "  Schedule: 10:00 AM PST, Monday-Friday"
echo ""
echo "  The daily-blog task will:"
echo "    1. Generate a blog post for a rotating ArcBlock product"
echo "    2. Create code examples and diagrams"
echo "    3. Add to review queue for your approval"
echo ""
echo "  Commands:"
echo "    npm run reviews           # Check pending reviews"
echo "    npm run dashboard         # View automation dashboard"
echo ""
echo "  To uninstall:"
echo "    launchctl unload ~/Library/LaunchAgents/$PLIST_NAME"
echo "    rm ~/Library/LaunchAgents/$PLIST_NAME"
echo ""
echo "  To test manually:"
echo "    npm run generate-blog"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
