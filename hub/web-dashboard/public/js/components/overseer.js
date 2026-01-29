/**
 * Overseer Component - Displays overseer agent status and activity
 */

class Overseer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.status = null;
    this.log = [];
  }

  async refresh() {
    try {
      const [status, log] = await Promise.all([
        API.getOverseerStatus(),
        API.getOverseerLog(20)
      ]);
      this.status = status;
      this.log = log;
      this.render();
    } catch (error) {
      console.error('Failed to load overseer data:', error);
    }
  }

  render() {
    if (!this.container) return;

    const statusHtml = this.renderStatus();
    const logHtml = this.renderLog();

    this.container.innerHTML = `
      <div class="overseer-status">
        ${statusHtml}
      </div>
      <div class="overseer-log">
        <div class="overseer-log-header">Activity Log</div>
        <div class="overseer-log-entries">
          ${logHtml}
        </div>
      </div>
    `;
  }

  renderStatus() {
    if (!this.status || this.status.status === 'not_running') {
      return `
        <div class="overseer-badge offline">
          <span class="overseer-icon">&#9679;</span>
          <span>Overseer Offline</span>
        </div>
        <div class="overseer-hint">Run <code>npm run overseer</code> to start</div>
      `;
    }

    const statusClass = this.getStatusClass(this.status.status);
    const statusLabel = this.getStatusLabel(this.status.status);
    const summary = this.status.healthSummary || {};

    return `
      <div class="overseer-badge ${statusClass}">
        <span class="overseer-icon ${statusClass === 'healthy' ? 'pulse' : ''}">&#9679;</span>
        <span>${statusLabel}</span>
      </div>
      <div class="overseer-metrics">
        <div class="metric">
          <span class="metric-value">${this.status.checksPerformed || 0}</span>
          <span class="metric-label">Checks</span>
        </div>
        <div class="metric">
          <span class="metric-value">${summary.successRate || 0}%</span>
          <span class="metric-label">Success</span>
        </div>
        <div class="metric">
          <span class="metric-value">${summary.pendingReviews || 0}</span>
          <span class="metric-label">Reviews</span>
        </div>
        <div class="metric">
          <span class="metric-value">${(this.status.currentIssues || []).length}</span>
          <span class="metric-label">Issues</span>
        </div>
      </div>
      ${this.renderIssues()}
    `;
  }

  renderIssues() {
    const issues = this.status?.currentIssues || [];
    if (issues.length === 0) return '';

    return `
      <div class="overseer-issues">
        ${issues.slice(0, 3).map(issue => `
          <div class="issue-item">
            <span class="issue-icon">&#9888;</span>
            <span class="issue-text">${this.formatIssue(issue)}</span>
          </div>
        `).join('')}
        ${issues.length > 3 ? `<div class="issue-more">+${issues.length - 3} more</div>` : ''}
      </div>
    `;
  }

  renderLog() {
    if (this.log.length === 0) {
      return '<div class="empty-state">No activity yet</div>';
    }

    return this.log.map(entry => {
      const typeClass = this.getLogTypeClass(entry.type);
      const icon = this.getLogIcon(entry.type);
      const time = this.formatTime(entry.timestamp);

      return `
        <div class="log-entry ${typeClass}">
          <span class="log-icon">${icon}</span>
          <span class="log-time">${time}</span>
          <span class="log-message">${entry.message}</span>
        </div>
      `;
    }).join('');
  }

  getStatusClass(status) {
    switch (status) {
      case 'healthy':
      case 'running':
        return 'healthy';
      case 'issues_detected':
        return 'warning';
      case 'error':
        return 'error';
      default:
        return 'offline';
    }
  }

  getStatusLabel(status) {
    switch (status) {
      case 'healthy':
        return 'All Systems Healthy';
      case 'running':
        return 'Running';
      case 'issues_detected':
        return 'Issues Detected';
      case 'error':
        return 'Error';
      case 'starting':
        return 'Starting...';
      default:
        return 'Offline';
    }
  }

  getLogTypeClass(type) {
    switch (type) {
      case 'alert':
        return 'alert';
      case 'error':
        return 'error';
      case 'action':
        return 'action';
      case 'check':
        return 'check';
      default:
        return 'info';
    }
  }

  getLogIcon(type) {
    switch (type) {
      case 'alert':
        return '&#9888;'; // Warning triangle
      case 'error':
        return '&#10007;'; // X
      case 'action':
        return '&#9889;'; // Lightning bolt
      case 'check':
        return '&#128269;'; // Magnifying glass
      default:
        return '&#8226;'; // Bullet
    }
  }

  formatIssue(issue) {
    if (issue.issue === 'stuck') {
      return `${issue.task} stuck for ${issue.runningMinutes}m`;
    }
    if (issue.issue === 'missed_schedule') {
      return `${issue.task} overdue by ${issue.hoursOverdue}h`;
    }
    if (issue.type === 'stale_review') {
      return `Review pending ${issue.ageHours}h: ${issue.title}`;
    }
    if (issue.type === 'large_review_queue') {
      return `${issue.count} reviews in queue`;
    }
    if (issue.type === 'high_failure_rate') {
      return `${issue.failureRate}% failure rate`;
    }
    if (issue.type === 'no_recent_activity') {
      return `No activity in ${issue.hoursSinceActivity}h`;
    }
    return JSON.stringify(issue);
  }

  formatTime(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }
}
