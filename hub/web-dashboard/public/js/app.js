/**
 * Main Application - Content Automation Hub Web Dashboard
 */

// Global component instances
let timeline;
let kanban;
let activity;
let stats;
let eventStream;

// Current review being viewed
let currentReviewId = null;

// ═══════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Initialize components
  timeline = new Timeline('timeline');
  kanban = new Kanban();
  activity = new Activity('activity-log');
  stats = new Stats();

  // Initial data load
  refreshAll();

  // Set up timeline navigation
  document.getElementById('prev-day')?.addEventListener('click', () => timeline.prevDay());
  document.getElementById('next-day')?.addEventListener('click', () => timeline.nextDay());
  document.getElementById('today-btn')?.addEventListener('click', () => timeline.today());

  // Set up review modal buttons
  document.getElementById('btn-approve')?.addEventListener('click', () => approveCurrentReview());
  document.getElementById('btn-reject')?.addEventListener('click', () => rejectCurrentReview());

  // Update clock
  updateClock();
  setInterval(updateClock, 1000);

  // Connect to SSE for real-time updates
  eventStream = new EventStream(handleServerEvent);
  eventStream.connect();

  // Fallback polling (every 10 seconds)
  setInterval(refreshAll, 10000);

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboard);
});

// ═══════════════════════════════════════════════════════════════
// Data Refresh
// ═══════════════════════════════════════════════════════════════

async function refreshAll() {
  await Promise.all([
    timeline.refresh(),
    kanban.refresh(),
    activity.refresh(),
    stats.refresh()
  ]);
}

// ═══════════════════════════════════════════════════════════════
// Event Handlers
// ═══════════════════════════════════════════════════════════════

function handleServerEvent(event) {
  console.log('SSE event:', event.type);

  switch (event.type) {
    case 'connected':
    case 'heartbeat':
      // Connection alive
      break;

    case 'state-change':
    case 'history-change':
      kanban.refresh();
      activity.refresh();
      stats.refresh();
      timeline.refresh();
      break;

    case 'reviews-change':
      kanban.refresh();
      stats.refresh();
      break;

    default:
      // Unknown event, refresh everything
      refreshAll();
  }
}

function handleKeyboard(e) {
  // Ignore if typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key.toLowerCase()) {
    case 'r':
      refreshAll();
      break;
    case 'escape':
      closeModal();
      break;
    case 't':
      timeline.today();
      break;
    case 'arrowleft':
      timeline.prevDay();
      break;
    case 'arrowright':
      timeline.nextDay();
      break;
  }
}

// ═══════════════════════════════════════════════════════════════
// UI Helpers
// ═══════════════════════════════════════════════════════════════

function updateClock() {
  const el = document.getElementById('current-time');
  if (el) {
    el.textContent = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// Task Details (placeholder)
// ═══════════════════════════════════════════════════════════════

function showTaskDetails(taskName) {
  console.log('Show task details:', taskName);
  // Could show a modal with task details
  // For now, just log it
}

// ═══════════════════════════════════════════════════════════════
// Review Modal
// ═══════════════════════════════════════════════════════════════

async function showReviewModal(reviewId) {
  currentReviewId = reviewId;

  try {
    const review = await API.getReview(reviewId);

    const modal = document.getElementById('review-modal');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');

    if (!modal || !title || !body) return;

    title.textContent = review.title || 'Review Details';

    body.innerHTML = `
      <div class="review-details">
        <p><strong>Type:</strong> ${review.type || 'N/A'}</p>
        <p><strong>Product:</strong> ${review.product || 'N/A'}</p>
        <p><strong>Content Type:</strong> ${review.contentType || 'N/A'}</p>
        <p><strong>Created:</strong> ${new Date(review.createdAt).toLocaleString()}</p>
        ${review.files ? `
          <p><strong>Files:</strong></p>
          <ul>
            ${review.files.map(f => `<li>${f}</li>`).join('')}
          </ul>
        ` : ''}
        ${review.heroImagePrompt ? `
          <p><strong>Hero Image Prompt:</strong></p>
          <p style="font-size: 0.875rem; color: var(--text-secondary);">${review.heroImagePrompt}</p>
        ` : ''}
      </div>
    `;

    modal.classList.remove('hidden');
  } catch (error) {
    console.error('Failed to load review:', error);
    alert('Failed to load review details');
  }
}

function closeModal() {
  const modal = document.getElementById('review-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  currentReviewId = null;
}

async function approveCurrentReview() {
  if (!currentReviewId) return;

  try {
    await API.approveReview(currentReviewId);
    closeModal();
    refreshAll();
  } catch (error) {
    console.error('Failed to approve review:', error);
    alert('Failed to approve review');
  }
}

async function rejectCurrentReview() {
  if (!currentReviewId) return;

  const reason = prompt('Enter rejection reason (optional):');

  try {
    await API.rejectReview(currentReviewId, reason || '');
    closeModal();
    refreshAll();
  } catch (error) {
    console.error('Failed to reject review:', error);
    alert('Failed to reject review');
  }
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
  const modal = document.getElementById('review-modal');
  if (e.target === modal) {
    closeModal();
  }
});
