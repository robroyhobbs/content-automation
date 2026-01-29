#!/bin/bash
#
# Install Content Automation Overseer Agent on macOS
# Runs continuously, monitoring task health
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_NAME="com.robroyhobbs.content-automation-overseer.plist"
PLIST_SRC="$SCRIPT_DIR/$PLIST_NAME"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_DIR="$PROJECT_DIR/logs"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Content Automation Hub - Overseer Agent Install"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Create logs directory
mkdir -p "$LOG_DIR"
echo "✓ Created logs directory: $LOG_DIR"

# Create LaunchAgents directory if needed
mkdir -p "$HOME/Library/LaunchAgents"

# Unload existing if present
if launchctl list | grep -q "com.robroyhobbs.content-automation-overseer"; then
    echo "  Unloading existing overseer..."
    launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

# Copy plist
cp "$PLIST_SRC" "$PLIST_DEST"
echo "✓ Installed plist to: $PLIST_DEST"

# Load the overseer
launchctl load "$PLIST_DEST"
echo "✓ Loaded overseer agent"

# Verify
sleep 1
if launchctl list | grep -q "com.robroyhobbs.content-automation-overseer"; then
    echo "✓ Overseer agent is running"
else
    echo "✗ Warning: Overseer may not be running"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  OVERSEER INSTALLED SUCCESSFULLY"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  The Overseer Agent monitors:"
echo "    - Stuck tasks (running > 30 min)"
echo "    - Missed schedules"
echo "    - Stale reviews (pending > 24h)"
echo "    - System health (failure rates)"
echo ""
echo "  View status:"
echo "    npm run web                    # Web dashboard"
echo "    cat data/overseer-state.json   # Current state"
echo "    cat data/overseer-log.json     # Activity log"
echo ""
echo "  To uninstall:"
echo "    launchctl unload ~/Library/LaunchAgents/$PLIST_NAME"
echo "    rm ~/Library/LaunchAgents/$PLIST_NAME"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
