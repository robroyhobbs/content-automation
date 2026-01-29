/**
 * Timeline Component - 24-hour view of scheduled/completed tasks
 */

class Timeline {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentDate = new Date();
    this.data = null;
  }

  setDate(date) {
    this.currentDate = date;
    this.updateDateDisplay();
  }

  prevDay() {
    this.currentDate.setDate(this.currentDate.getDate() - 1);
    this.updateDateDisplay();
    this.refresh();
  }

  nextDay() {
    this.currentDate.setDate(this.currentDate.getDate() + 1);
    this.updateDateDisplay();
    this.refresh();
  }

  today() {
    this.currentDate = new Date();
    this.updateDateDisplay();
    this.refresh();
  }

  updateDateDisplay() {
    const dateEl = document.getElementById('timeline-date');
    if (!dateEl) return;

    const today = new Date();
    const isToday = this.currentDate.toDateString() === today.toDateString();

    if (isToday) {
      dateEl.textContent = 'Today';
    } else {
      dateEl.textContent = this.currentDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
    }
  }

  async refresh() {
    try {
      const dateStr = this.currentDate.toISOString().split('T')[0];
      this.data = await API.getTimeline(dateStr);
      this.render();
    } catch (error) {
      console.error('Failed to load timeline:', error);
    }
  }

  render() {
    if (!this.container || !this.data) return;

    const currentHour = new Date().getHours();
    const isToday = this.currentDate.toDateString() === new Date().toDateString();

    this.container.innerHTML = this.data.hours.map(hourData => {
      const isCurrent = isToday && hourData.hour === currentHour;
      const hourLabel = this.formatHour(hourData.hour);

      const markers = [
        ...hourData.scheduled.map(() => '<span class="timeline-marker scheduled" title="Scheduled"></span>'),
        ...hourData.completed.map(task => `<span class="timeline-marker completed" title="${task} - Completed"></span>`),
        ...hourData.failed.map(task => `<span class="timeline-marker failed" title="${task} - Failed"></span>`)
      ].join('');

      return `
        <div class="timeline-hour ${isCurrent ? 'current' : ''}" data-hour="${hourData.hour}">
          <span class="hour-label">${hourLabel}</span>
          <div class="hour-markers">${markers || '&nbsp;'}</div>
        </div>
      `;
    }).join('');
  }

  formatHour(hour) {
    if (hour === 0) return '12am';
    if (hour === 12) return '12pm';
    if (hour > 12) return `${hour - 12}pm`;
    return `${hour}am`;
  }
}
