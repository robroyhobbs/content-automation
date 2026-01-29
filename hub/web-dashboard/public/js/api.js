/**
 * API Client for Content Automation Hub
 */

const API = {
  baseUrl: '/api',

  async get(endpoint) {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`API GET ${endpoint} failed:`, error);
      throw error;
    }
  },

  async post(endpoint, data = {}) {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`API POST ${endpoint} failed:`, error);
      throw error;
    }
  },

  // Convenience methods
  getState() {
    return this.get('/state');
  },

  getTasks() {
    return this.get('/tasks');
  },

  getHistory(limit = 50) {
    return this.get(`/history?limit=${limit}`);
  },

  getReviews() {
    return this.get('/reviews');
  },

  getPendingReviews() {
    return this.get('/reviews/pending');
  },

  getReview(id) {
    return this.get(`/reviews/${id}`);
  },

  getStats() {
    return this.get('/stats');
  },

  getTimeline(date) {
    const dateParam = date ? `?date=${date}` : '';
    return this.get(`/timeline${dateParam}`);
  },

  approveReview(id, notes = '') {
    return this.post(`/reviews/${id}/approve`, { notes });
  },

  rejectReview(id, reason = '') {
    return this.post(`/reviews/${id}/reject`, { reason });
  }
};

// SSE Event Source for real-time updates
class EventStream {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.eventSource = null;
    this.reconnectDelay = 1000;
  }

  connect() {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource('/api/events');

    this.eventSource.onopen = () => {
      console.log('SSE connected');
      this.reconnectDelay = 1000;
      this.updateConnectionStatus(true);
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onMessage(data);
      } catch (e) {
        console.error('SSE parse error:', e);
      }
    };

    this.eventSource.onerror = () => {
      console.log('SSE disconnected, reconnecting...');
      this.updateConnectionStatus(false);
      this.eventSource.close();

      // Reconnect with exponential backoff
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    };
  }

  updateConnectionStatus(connected) {
    const statusDot = document.getElementById('connection-status');
    if (statusDot) {
      statusDot.classList.toggle('connected', connected);
      statusDot.title = connected ? 'Connected' : 'Disconnected';
    }
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
