/**
 * Activity Log Component - Recent task executions
 */

class Activity {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.history = [];
  }

  async refresh() {
    try {
      this.history = await API.getHistory(20);
      this.render();
    } catch (error) {
      console.error('Failed to load activity:', error);
    }
  }

  render() {
    if (!this.container) return;

    if (this.history.length === 0) {
      this.container.innerHTML = '<div class="empty-state">No recent activity</div>';
      return;
    }

    this.container.innerHTML = this.history.map(entry => {
      const icon = entry.success ? '&#10003;' : '&#10007;';
      const iconClass = entry.success ? 'success' : 'failed';
      const time = this.formatTime(entry.timestamp);

      return `
        <div class="activity-item">
          <span class="activity-icon ${iconClass}">${icon}</span>
          <span class="activity-time">${time}</span>
          <span class="activity-task">${entry.task}</span>
        </div>
      `;
    }).join('');
  }

  formatTime(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }
}
