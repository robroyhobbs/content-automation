/**
 * Kanban Board Component - Task status columns
 */

class Kanban {
  constructor() {
    this.tasks = [];
    this.reviews = { pending: [], completed: [], rejected: [] };
    this.history = [];
    this.tomorrowSchedule = null;
  }

  async refresh() {
    try {
      const [tasks, reviews, history, tomorrow] = await Promise.all([
        API.getTasks(),
        API.getReviews(),
        API.getHistory(20),
        API.getTomorrowSchedule()
      ]);

      this.tasks = tasks;
      this.reviews = reviews;
      this.history = history;
      this.tomorrowSchedule = tomorrow;
      this.render();
    } catch (error) {
      console.error('Failed to load kanban data:', error);
    }
  }

  render() {
    this.renderScheduled();
    this.renderRunning();
    this.renderReview();
    this.renderCompleted();
  }

  renderScheduled() {
    const container = document.getElementById('list-scheduled');
    const countEl = document.getElementById('count-scheduled');
    const headerEl = document.querySelector('#col-scheduled .column-title');
    if (!container) return;

    // Get tasks that are scheduled but haven't run today
    const today = new Date().toISOString().split('T')[0];
    const scheduled = this.tasks.filter(task => {
      if (!task.enabled) return false;
      if (task.state.isRunning) return false;

      // Check if already completed today
      const lastRun = task.state.lastRun;
      if (lastRun && lastRun.startsWith(today)) return false;

      return task.schedule; // Has a schedule
    });

    // If no tasks scheduled today, show tomorrow's schedule
    if (scheduled.length === 0 && this.tomorrowSchedule?.tasks?.length > 0) {
      if (headerEl) headerEl.textContent = 'Tomorrow';
      if (countEl) countEl.textContent = this.tomorrowSchedule.tasks.length;

      container.innerHTML = `
        <div class="schedule-date">${this.tomorrowSchedule.date}</div>
        ${this.tomorrowSchedule.tasks.map(task => `
          <div class="task-card tomorrow" onclick="showTaskDetails('${task.name}')">
            <div class="task-name">${task.name}</div>
            <div class="task-meta">${task.time}</div>
          </div>
        `).join('')}
      `;
      return;
    }

    // Show today's scheduled tasks
    if (headerEl) headerEl.textContent = 'Scheduled';
    if (countEl) countEl.textContent = scheduled.length;

    if (scheduled.length === 0) {
      container.innerHTML = '<div class="empty-state">All tasks completed today</div>';
      return;
    }

    container.innerHTML = scheduled.map(task => `
      <div class="task-card" onclick="showTaskDetails('${task.name}')">
        <div class="task-name">${task.name}</div>
        <div class="task-meta">${this.formatSchedule(task.schedule)}</div>
      </div>
    `).join('');
  }

  renderRunning() {
    const container = document.getElementById('list-running');
    const countEl = document.getElementById('count-running');
    if (!container) return;

    const running = this.tasks.filter(task => task.state.isRunning);

    if (countEl) countEl.textContent = running.length;

    if (running.length === 0) {
      container.innerHTML = '<div class="empty-state">No tasks running</div>';
      return;
    }

    container.innerHTML = running.map(task => `
      <div class="task-card running" onclick="showTaskDetails('${task.name}')">
        <div class="task-name">${task.name}</div>
        <div class="task-meta">Running...</div>
      </div>
    `).join('');
  }

  renderReview() {
    const container = document.getElementById('list-review');
    const countEl = document.getElementById('count-review');
    if (!container) return;

    const pending = this.reviews.pending || [];

    if (countEl) countEl.textContent = pending.length;

    if (pending.length === 0) {
      container.innerHTML = '<div class="empty-state">No pending reviews</div>';
      return;
    }

    container.innerHTML = pending.map(review => `
      <div class="task-card review" onclick="showReviewModal('${review.id}')">
        <div class="task-name">${review.title || review.type}</div>
        <div class="task-meta">${review.product || ''} - ${this.formatTime(review.createdAt)}</div>
      </div>
    `).join('');
  }

  renderCompleted() {
    const container = document.getElementById('list-completed');
    const countEl = document.getElementById('count-completed');
    if (!container) return;

    // Get today's completed tasks from history
    const today = new Date().toISOString().split('T')[0];
    const todayCompleted = this.history.filter(entry =>
      entry.timestamp &&
      entry.timestamp.startsWith(today) &&
      entry.success
    );

    if (countEl) countEl.textContent = todayCompleted.length;

    if (todayCompleted.length === 0) {
      container.innerHTML = '<div class="empty-state">No tasks completed today</div>';
      return;
    }

    container.innerHTML = todayCompleted.slice(0, 10).map(entry => `
      <div class="task-card success" onclick="showTaskDetails('${entry.task}')">
        <div class="task-name">${entry.task}</div>
        <div class="task-meta">${this.formatTime(entry.timestamp)}</div>
      </div>
    `).join('');
  }

  formatSchedule(schedule) {
    if (!schedule) return '';

    // Parse simple cron format "M H * * *"
    const match = schedule.match(/^(\d+)\s+(\d+)/);
    if (match) {
      const hour = parseInt(match[2]);
      const minute = parseInt(match[1]);
      return `@ ${this.formatHour(hour)}:${minute.toString().padStart(2, '0')}`;
    }

    return schedule;
  }

  formatHour(hour) {
    if (hour === 0) return '12am';
    if (hour === 12) return '12pm';
    if (hour > 12) return `${hour - 12}pm`;
    return `${hour}am`;
  }

  formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }
}
