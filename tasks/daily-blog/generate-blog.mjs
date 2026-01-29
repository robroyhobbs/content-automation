#!/usr/bin/env node
/**
 * Generate a complete blog post with all assets
 *
 * Creates:
 * - Article with code examples
 * - Mermaid diagram
 * - Hero image prompt (for AI generation)
 *
 * Run: node tasks/daily-blog/generate-blog.mjs [product]
 * Products: AIGNE, MyVibe, ArcBlock, ArcSphere
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { addReview } from '../../hub/shared/reviews.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, 'task.yaml');
const DATA_DIR = join(__dirname, '..', '..', 'data', 'blog-drafts');

// Ensure output directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load config from YAML
 */
function loadConfig() {
  const yamlContent = readFileSync(CONFIG_FILE, 'utf8');
  const config = YAML.parse(yamlContent);
  return config.settings;
}

/**
 * Run Claude Code CLI
 */
async function runClaude(prompt, timeout = 300) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dangerously-skip-permissions',
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      prompt
    ];

    const child = spawn('claude', args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH}`,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        CI: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let extractedText = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) {
                extractedText += block.text;
              }
            }
          }
        } catch (e) {
          extractedText += trimmed;
        }
      }
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Timeout'));
    }, timeout * 1000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (extractedText.length > 100) {
        resolve(extractedText);
      } else {
        reject(new Error(`Claude failed with code ${code}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Generate URL slug from title
 */
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

/**
 * Extract section from delimiter-based output
 */
function extractSection(text, name) {
  const regex = new RegExp(`===${name}===\\s*([\\s\\S]*?)\\s*===END_${name}===`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Blog Post Generator with Assets');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const config = loadConfig();
  const requestedProduct = process.argv[2];

  // Select product
  let product;
  if (requestedProduct) {
    product = config.products.find(p =>
      p.name.toLowerCase() === requestedProduct.toLowerCase()
    );
    if (!product) {
      console.error(`Unknown product: ${requestedProduct}`);
      console.log('Available: ' + config.products.map(p => p.name).join(', '));
      process.exit(1);
    }
  } else {
    // Random selection
    product = config.products[Math.floor(Math.random() * config.products.length)];
  }

  // Random content type
  const contentType = config.contentTypes[Math.floor(Math.random() * config.contentTypes.length)];

  console.log(`Product: ${product.name}`);
  console.log(`Type: ${contentType.type}`);
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Generate Article
  // ═══════════════════════════════════════════════════════════════
  console.log('STEP 1: Generating article...');

  const articlePrompt = `You are a senior technical writer creating a blog post for arcblock.io.

PRODUCT: ${product.name}
DESCRIPTION: ${product.description}
TYPE: ${contentType.type}
KEYWORDS: ${product.keywords.join(', ')}

Write a technical blog post (1200-1800 words) that:
- Has a compelling, SEO-friendly title (under 60 chars)
- Includes 2-3 REAL code examples (not pseudocode)
- Uses technical depth without jargon
- Takes a clear position or teaches something practical
- Avoids marketing buzzwords like: leverage, synergy, paradigm, robust

${contentType.type === 'how-to' ? 'Structure as a step-by-step guide with clear sections.' : ''}
${contentType.type === 'opinion' ? 'Write from a technical founders perspective with strong opinions.' : ''}
${contentType.type === 'feature' ? 'Highlight specific capabilities with concrete use cases.' : ''}
${contentType.type === 'news' ? 'Connect to current industry trends in AI/blockchain.' : ''}

OUTPUT FORMAT - Use these exact delimiters:

===TITLE===
[Title under 60 chars]
===END_TITLE===

===META===
[Meta description under 160 chars]
===END_META===

===SLUG===
[url-friendly-slug]
===END_SLUG===

===TAGS===
[tag1, tag2, tag3]
===END_TAGS===

===HERO_IMAGE_PROMPT===
[Detailed prompt for generating a hero image - describe the visual concept, colors, style]
===END_HERO_IMAGE_PROMPT===

===DIAGRAM_DESCRIPTION===
[Describe a technical diagram that would enhance this article - what it shows, key components]
===END_DIAGRAM_DESCRIPTION===

===CONTENT===
[Full markdown article with # Title, ## Sections, \`\`\`code blocks\`\`\`, etc.]
===END_CONTENT===`;

  let article;
  try {
    const result = await runClaude(articlePrompt, 600);

    article = {
      title: extractSection(result, 'TITLE'),
      metaDescription: extractSection(result, 'META'),
      slug: extractSection(result, 'SLUG'),
      tags: (extractSection(result, 'TAGS') || '').split(',').map(t => t.trim()).filter(t => t),
      heroImagePrompt: extractSection(result, 'HERO_IMAGE_PROMPT'),
      diagramDescription: extractSection(result, 'DIAGRAM_DESCRIPTION'),
      content: extractSection(result, 'CONTENT')
    };

    if (!article.title || !article.content) {
      throw new Error('Missing title or content in response');
    }

    console.log(`  Title: "${article.title}"`);
    console.log(`  Words: ~${article.content.split(/\s+/).length}`);
    console.log(`  Code blocks: ${(article.content.match(/```/g) || []).length / 2}`);
    console.log('');
  } catch (err) {
    console.error(`Failed to generate article: ${err.message}`);
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Generate Mermaid Diagram
  // ═══════════════════════════════════════════════════════════════
  console.log('STEP 2: Generating Mermaid diagram...');

  let mermaidCode = null;
  try {
    const diagramPrompt = `Create a Mermaid diagram based on this description:

${article.diagramDescription}

CONTEXT: This is for a blog post titled "${article.title}" about ${product.name}.

RULES:
- Use flowchart TD, sequenceDiagram, or graph LR (most appropriate for the concept)
- Keep it simple (5-10 nodes max)
- Use clear, short labels
- Make it visually illustrate a key concept from the article

Respond with ONLY the Mermaid code, starting with the diagram type. No explanation.`;

    const diagramResult = await runClaude(diagramPrompt, 60);

    // Extract the Mermaid code
    const mermaidMatch = diagramResult.match(/(flowchart|sequenceDiagram|graph|mindmap|classDiagram)[\s\S]+?(?=\n\n\n|$)/);
    if (mermaidMatch) {
      mermaidCode = mermaidMatch[0].trim();
      console.log(`  Type: ${mermaidMatch[1]}`);
      console.log('');
    } else {
      console.log('  (Could not extract valid Mermaid code)');
      console.log('');
    }
  } catch (err) {
    console.log(`  Failed: ${err.message}`);
    console.log('');
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Save Output
  // ═══════════════════════════════════════════════════════════════
  console.log('STEP 3: Saving draft...');

  const today = new Date().toISOString().split('T')[0];
  const slug = article.slug || generateSlug(article.title);
  const baseFilename = `${today}-${slug}`;

  // Save JSON
  const jsonData = {
    title: article.title,
    metaDescription: article.metaDescription,
    slug: slug,
    tags: [...new Set([...product.tags, ...article.tags])],
    content: article.content,
    heroImagePrompt: article.heroImagePrompt,
    mermaidDiagram: mermaidCode,
    product: product.name,
    contentType: contentType.type,
    generatedAt: new Date().toISOString(),
    assets: {
      hasCodeExamples: article.content.includes('```'),
      hasMermaidDiagram: !!mermaidCode,
      heroImagePromptReady: !!article.heroImagePrompt
    }
  };

  const jsonFile = join(DATA_DIR, `${baseFilename}.json`);
  writeFileSync(jsonFile, JSON.stringify(jsonData, null, 2));

  // Save Markdown
  const markdownContent = `# ${article.title}

> ${article.metaDescription}

**Product:** ${product.name} | **Type:** ${contentType.type} | **Tags:** ${jsonData.tags.join(', ')}

---

${article.content}

${mermaidCode ? `
---

## Technical Diagram

\`\`\`mermaid
${mermaidCode}
\`\`\`

*Preview this diagram at: https://mermaid.live*
` : ''}

---

## Hero Image

**Generation Prompt:**
> ${article.heroImagePrompt}

*Use this prompt with an AI image generator like Midjourney, DALL-E, or Replicate.*

---

*Generated: ${new Date().toISOString()}*
*Status: Ready for manual publishing*
`;

  const mdFile = join(DATA_DIR, `${baseFilename}.md`);
  writeFileSync(mdFile, markdownContent);

  console.log(`  JSON: ${jsonFile}`);
  console.log(`  Markdown: ${mdFile}`);
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: Add to Review Queue
  // ═══════════════════════════════════════════════════════════════
  console.log('STEP 4: Adding to review queue...');

  const review = addReview({
    type: 'blog-post',
    title: article.title,
    product: product.name,
    contentType: contentType.type,
    files: [mdFile, jsonFile],
    heroImagePrompt: article.heroImagePrompt,
    publishUrl: 'https://www.arcblock.io/blog/blog/new',
    assets: {
      article: true,
      codeExamples: article.content.includes('```'),
      diagram: !!mermaidCode,
      heroImagePrompt: !!article.heroImagePrompt
    }
  });

  console.log(`  Review ID: ${review.id}`);
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  DRAFT COMPLETE - PENDING YOUR REVIEW');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Title: ${article.title}`);
  console.log(`  Product: ${product.name}`);
  console.log(`  Type: ${contentType.type}`);
  console.log(`  Review ID: ${review.id}`);
  console.log('');
  console.log('  Assets:');
  console.log(`    ✓ Article with code examples`);
  console.log(`    ${mermaidCode ? '✓' : '✗'} Diagram`);
  console.log(`    ✓ Hero image prompt ready`);
  console.log('');
  console.log('  Files:');
  console.log(`    ${mdFile}`);
  console.log('');
  console.log('  Review Commands:');
  console.log(`    npm run reviews                    # List pending reviews`);
  console.log(`    npm run reviews view ${review.id}  # View this review`);
  console.log(`    npm run reviews approve ${review.id}  # Approve`);
  console.log('');
  console.log('  To generate hero image, run:');
  console.log(`    /ai-image-generation ${article.heroImagePrompt.substring(0, 60)}...`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
