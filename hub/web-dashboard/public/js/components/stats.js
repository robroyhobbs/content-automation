/**
 * Stats Component - Dashboard statistics
 */

class Stats {
  constructor() {
    this.data = null;
  }

  async refresh() {
    try {
      this.data = await API.getStats();
      this.render();
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  }

  render() {
    if (!this.data) return;

    this.updateElement('stat-completed', this.data.today?.completed || 0);
    this.updateElement('stat-failed', this.data.today?.failed || 0);
    this.updateElement('stat-reviews', this.data.reviews?.pending || 0);
    this.updateElement('stat-rate', `${this.data.global?.successRate || 0}%`);
  }

  updateElement(id, value) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  }
}
