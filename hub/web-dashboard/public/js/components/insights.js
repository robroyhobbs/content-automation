/**
 * Insights Component - Displays learning insights and recommendations
 */

class Insights {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.summary = null;
    this.insights = [];
    this.recommendations = [];
  }

  async refresh() {
    try {
      const [summary, insightsData] = await Promise.all([
        API.getLearningSummary(),
        API.getLearningInsights()
      ]);
      this.summary = summary;
      this.insights = insightsData.insights || [];
      this.recommendations = insightsData.recommendations || [];
      this.render();
    } catch (error) {
      console.error('Failed to load insights:', error);
    }
  }

  render() {
    if (!this.container) return;

    const summaryHtml = this.renderSummary();
    const insightsHtml = this.renderInsights();
    const recommendationsHtml = this.renderRecommendations();

    this.container.innerHTML = `
      <div class="insights-summary">
        ${summaryHtml}
      </div>
      <div class="insights-content">
        ${insightsHtml}
        ${recommendationsHtml}
      </div>
    `;
  }

  renderSummary() {
    if (!this.summary) {
      return `
        <div class="insights-badge learning">
          <span class="insights-icon">&#128200;</span>
          <span>Learning Loop Active</span>
        </div>
        <div class="insights-hint">Collecting data...</div>
      `;
    }

    const hasInsights = this.insights.length > 0 || this.recommendations.length > 0;

    return `
      <div class="insights-badge ${hasInsights ? 'has-insights' : 'learning'}">
        <span class="insights-icon">&#128200;</span>
        <span>${hasInsights ? `${this.insights.length} Insights` : 'Learning'}</span>
      </div>
      <div class="insights-metrics">
        <div class="metric">
          <span class="metric-value">${this.summary.totalOutcomes || 0}</span>
          <span class="metric-label">Samples</span>
        </div>
        <div class="metric">
          <span class="metric-value">${this.summary.recentSuccessRate || 0}%</span>
          <span class="metric-label">Success</span>
        </div>
        <div class="metric">
          <span class="metric-value">${this.recommendations.length}</span>
          <span class="metric-label">Actions</span>
        </div>
      </div>
    `;
  }

  renderInsights() {
    if (this.insights.length === 0) {
      return `<div class="insights-section">
        <div class="insights-section-header">Insights</div>
        <div class="empty-state small">More data needed</div>
      </div>`;
    }

    return `
      <div class="insights-section">
        <div class="insights-section-header">Insights</div>
        <div class="insights-list">
          ${this.insights.slice(0, 3).map(insight => `
            <div class="insight-item ${insight.severity}">
              <span class="insight-icon">${this.getInsightIcon(insight.type)}</span>
              <span class="insight-text">${insight.message}</span>
            </div>
          `).join('')}
          ${this.insights.length > 3 ? `<div class="insight-more">+${this.insights.length - 3} more</div>` : ''}
        </div>
      </div>
    `;
  }

  renderRecommendations() {
    if (this.recommendations.length === 0) {
      return '';
    }

    return `
      <div class="insights-section">
        <div class="insights-section-header">Recommendations</div>
        <div class="recommendations-list">
          ${this.recommendations.slice(0, 3).map(rec => `
            <div class="recommendation-item ${rec.priority}">
              <span class="rec-icon">&#9889;</span>
              <span class="rec-text">${rec.message}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  getInsightIcon(type) {
    switch (type) {
      case 'low_success_rate': return '&#9888;';
      case 'timing_pattern': return '&#128336;';
      case 'recurring_error': return '&#10060;';
      default: return '&#128161;';
    }
  }
}

// API extensions for insights
API.getLearningSummary = function() {
  return this.get('/learning/summary');
};

API.getLearningInsights = function() {
  return this.get('/learning/insights');
};
