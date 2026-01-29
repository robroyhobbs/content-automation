/**
 * Review Queue Management
 * Tracks items pending human review/approval
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REVIEWS_FILE = join(__dirname, '..', '..', 'data', 'reviews.json');

/**
 * Load review queue
 */
export function loadReviews() {
  try {
    if (existsSync(REVIEWS_FILE)) {
      return JSON.parse(readFileSync(REVIEWS_FILE, 'utf8'));
    }
  } catch (e) {
    // Ignore
  }
  return { pending: [], completed: [], rejected: [] };
}

/**
 * Save review queue
 */
export function saveReviews(reviews) {
  writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2));
}

/**
 * Add item to review queue
 */
export function addReview(item) {
  const reviews = loadReviews();

  const review = {
    id: `rev_${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: 'pending',
    ...item
  };

  reviews.pending.push(review);
  saveReviews(reviews);

  return review;
}

/**
 * Get pending reviews
 */
export function getPendingReviews() {
  const reviews = loadReviews();
  return reviews.pending || [];
}

/**
 * Approve a review
 */
export function approveReview(reviewId, notes = '') {
  const reviews = loadReviews();

  const index = reviews.pending.findIndex(r => r.id === reviewId);
  if (index === -1) return null;

  const review = reviews.pending.splice(index, 1)[0];
  review.status = 'approved';
  review.approvedAt = new Date().toISOString();
  review.notes = notes;

  reviews.completed.push(review);
  saveReviews(reviews);

  return review;
}

/**
 * Reject a review
 */
export function rejectReview(reviewId, reason = '') {
  const reviews = loadReviews();

  const index = reviews.pending.findIndex(r => r.id === reviewId);
  if (index === -1) return null;

  const review = reviews.pending.splice(index, 1)[0];
  review.status = 'rejected';
  review.rejectedAt = new Date().toISOString();
  review.reason = reason;

  reviews.rejected.push(review);
  saveReviews(reviews);

  return review;
}

/**
 * Get review by ID
 */
export function getReview(reviewId) {
  const reviews = loadReviews();

  return reviews.pending.find(r => r.id === reviewId) ||
         reviews.completed.find(r => r.id === reviewId) ||
         reviews.rejected.find(r => r.id === reviewId);
}

export default {
  loadReviews,
  saveReviews,
  addReview,
  getPendingReviews,
  approveReview,
  rejectReview,
  getReview
};
