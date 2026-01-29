#!/usr/bin/env node
/**
 * Review Queue CLI
 * Manage pending reviews for blog posts and other content
 *
 * Usage:
 *   npm run reviews              # List pending reviews
 *   npm run reviews approve <id> # Approve a review
 *   npm run reviews reject <id>  # Reject a review
 *   npm run reviews view <id>    # View review details
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  getPendingReviews,
  approveReview,
  rejectReview,
  getReview,
  loadReviews
} from './shared/reviews.mjs';

const DRAFTS_DIR = join(homedir(), 'content-automation', 'data', 'blog-drafts');

function formatDate(isoString) {
  if (!isoString) return 'N/A';
  return new Date(isoString).toLocaleString();
}

function listPending() {
  const pending = getPendingReviews();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  PENDING REVIEWS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (pending.length === 0) {
    console.log('  No pending reviews.\n');
    return;
  }

  pending.forEach((review, i) => {
    console.log(`  ${i + 1}. [${review.id}]`);
    console.log(`     Type: ${review.type}`);
    console.log(`     Title: ${review.title}`);
    console.log(`     Created: ${formatDate(review.createdAt)}`);
    if (review.files) {
      console.log(`     Files:`);
      review.files.forEach(f => console.log(`       - ${f}`));
    }
    console.log('');
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Commands:');
  console.log('    npm run reviews view <id>     View details');
  console.log('    npm run reviews approve <id>  Approve');
  console.log('    npm run reviews reject <id>   Reject');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

function viewReview(reviewId) {
  const review = getReview(reviewId);

  if (!review) {
    console.error(`\nReview not found: ${reviewId}\n`);
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  REVIEW: ${review.id}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`  Type: ${review.type}`);
  console.log(`  Status: ${review.status.toUpperCase()}`);
  console.log(`  Title: ${review.title}`);
  console.log(`  Created: ${formatDate(review.createdAt)}`);

  if (review.product) console.log(`  Product: ${review.product}`);
  if (review.contentType) console.log(`  Content Type: ${review.contentType}`);

  if (review.files) {
    console.log('\n  Files:');
    review.files.forEach(f => {
      console.log(`    - ${f}`);
    });
  }

  if (review.assets) {
    console.log('\n  Assets:');
    Object.entries(review.assets).forEach(([key, val]) => {
      const icon = val ? '✓' : '✗';
      console.log(`    ${icon} ${key}`);
    });
  }

  if (review.heroImagePrompt) {
    console.log('\n  Hero Image Prompt:');
    console.log(`    "${review.heroImagePrompt.substring(0, 100)}..."`);
  }

  if (review.publishUrl) {
    console.log(`\n  Publish URL: ${review.publishUrl}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');

  if (review.status === 'pending') {
    console.log('  Actions:');
    console.log(`    npm run reviews approve ${review.id}`);
    console.log(`    npm run reviews reject ${review.id}`);
  } else if (review.status === 'approved') {
    console.log(`  Approved: ${formatDate(review.approvedAt)}`);
  } else if (review.status === 'rejected') {
    console.log(`  Rejected: ${formatDate(review.rejectedAt)}`);
    if (review.reason) console.log(`  Reason: ${review.reason}`);
  }

  console.log('═══════════════════════════════════════════════════════════════\n');

  // Show markdown preview if available
  if (review.files) {
    const mdFile = review.files.find(f => f.endsWith('.md'));
    if (mdFile) {
      console.log('  To preview markdown:');
      console.log(`    cat "${mdFile}" | head -50\n`);
    }
  }
}

function approve(reviewId) {
  const review = approveReview(reviewId);

  if (!review) {
    console.error(`\nReview not found or already processed: ${reviewId}\n`);
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  APPROVED');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`  Review: ${review.id}`);
  console.log(`  Title: ${review.title}`);
  console.log('');
  console.log('  Next step: Publish the content at');
  console.log(`  ${review.publishUrl || 'https://www.arcblock.io/blog/blog/new'}`);
  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

function reject(reviewId, reason) {
  const review = rejectReview(reviewId, reason);

  if (!review) {
    console.error(`\nReview not found or already processed: ${reviewId}\n`);
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  REJECTED');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`  Review: ${review.id}`);
  console.log(`  Title: ${review.title}`);
  if (reason) console.log(`  Reason: ${reason}`);
  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

// Main
const [,, command, ...args] = process.argv;

switch (command) {
  case 'view':
    if (!args[0]) {
      console.error('\nUsage: npm run reviews view <review-id>\n');
      process.exit(1);
    }
    viewReview(args[0]);
    break;

  case 'approve':
    if (!args[0]) {
      console.error('\nUsage: npm run reviews approve <review-id>\n');
      process.exit(1);
    }
    approve(args[0]);
    break;

  case 'reject':
    if (!args[0]) {
      console.error('\nUsage: npm run reviews reject <review-id> [reason]\n');
      process.exit(1);
    }
    reject(args[0], args.slice(1).join(' '));
    break;

  case 'list':
  default:
    listPending();
    break;
}
