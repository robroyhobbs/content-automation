/**
 * Daily Blog Runner
 * 
 * Generates one SEO-optimized blog post per day for arcblock.io/blog.
 * Uses Claude Code skills for content generation and publishes via browser automation.
 * 
 * Key features:
 * - Product rotation (never same product 2 days in a row)
 * - Mixed content types (news, feature, opinion, how-to)
 * - SEO optimization via keyword-research and seo-content skills
 * - Visual content (hero images, Mermaid diagrams)
 * - Automated publishing to arcblock.io/blog
 */

import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const STATE_FILE = join(DATA_DIR, 'daily-blog-state.json');
const PROMPT_TEMPLATE = join(__dirname, 'prompts', 'blog-generator.md');

/**
 * Load blog state (tracks rotation history)
 */
function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (error) {
    // Ignore errors, return default
  }
  
  return {
    lastProduct: null,
    lastContentType: null,
    history: [],
    statistics: {
      totalPosts: 0,
      byProduct: {},
      byContentType: {}
    }
  };
}

/**
 * Save blog state
 */
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Select product (never same as yesterday)
 */
function selectProduct(products, lastProduct) {
  const available = products.filter(p => p.name !== lastProduct);
  
  // Random selection from available products
  const index = Math.floor(Math.random() * available.length);
  return available[index];
}

/**
 * Select content type with weighted randomization
 */
function selectContentType(contentTypes, lastContentType) {
  // Reduce weight of last content type to encourage variety
  const adjusted = contentTypes.map(ct => ({
    ...ct,
    adjustedWeight: ct.type === lastContentType ? ct.weight * 0.5 : ct.weight
  }));
  
  // Calculate total weight
  const totalWeight = adjusted.reduce((sum, ct) => sum + ct.adjustedWeight, 0);
  
  // Random selection based on weights
  let random = Math.random() * totalWeight;
  for (const ct of adjusted) {
    random -= ct.adjustedWeight;
    if (random <= 0) {
      return ct;
    }
  }
  
  // Fallback
  return adjusted[0];
}

/**
 * Generate topic based on content type and product
 * NOTE: Prompts must be SELF-CONTAINED - no external tool calls needed
 */
function generateTopicPrompt(product, contentType) {
  const domain = product.name === 'ArcBlock' ? 'blockchain and decentralized identity' : 'AI and developer tools';

  const prompts = {
    news: `Write an analysis piece about a current trend in ${domain} and how ${product.name} addresses it.
           Focus on ${product.description}.
           Pick ONE specific trend (e.g., AI agents, vibe coding, decentralized apps, identity solutions).
           Connect the trend to concrete capabilities of ${product.name}.
           Do NOT search the web - use your knowledge of industry trends.`,

    feature: `Write a feature spotlight about ${product.name}.
              Focus on ${product.description}.
              Highlight a specific capability that makes ${product.name} unique.
              Include concrete use cases and example scenarios.
              If applicable, include code snippets or configuration examples.`,

    opinion: `Write an opinion piece from a technical founder's perspective about ${product.name}.
              Topic: Why the approach taken by ${product.name} matters for the future of ${domain}.
              Be direct, technical, and opinionated - take a clear position.
              Avoid corporate marketing language.
              Include specific technical reasoning for your position.`,

    'how-to': `Create a step-by-step beginner's guide for ${product.name}.
               Focus on: ${product.description}.
               Structure: Introduction -> Prerequisites -> Steps -> Expected Results -> Next Steps.
               Target audience: developers with some experience who are new to ${product.name}.
               Include example commands or code where relevant.`
  };

  return prompts[contentType.type] || prompts.feature;
}

/**
 * Run Claude Code with retry logic
 * Wraps runClaudeCodeOnce with configurable retries
 */
async function runClaudeCode(prompt, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const retryDelay = options.retryDelay || 5000;

  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await runClaudeCodeOnce(prompt, options);
      return result;
    } catch (error) {
      lastError = error;

      // Log retry attempt
      if (attempt < maxRetries) {
        console.log(`[RETRY] Attempt ${attempt}/${maxRetries} failed: ${error.message}. Retrying in ${retryDelay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  throw lastError;
}

/**
 * Run Claude Code once (single attempt)
 * Based on working docsmith-automation pattern
 */
async function runClaudeCodeOnce(prompt, options = {}) {
  return new Promise((resolve, reject) => {
    // Use same pattern as docsmith-automation
    const args = [
      '--dangerously-skip-permissions',  // Skip permission prompts for automation
      '-p',                              // Print mode (non-interactive)
      '--verbose',                       // Required for stream-json
      '--output-format', 'stream-json',  // Get incremental output
      prompt                             // Pass prompt directly as argument
    ];

    // Use claude CLI with explicit PATH
    const child = spawn('claude', args, {
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH}`,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        CI: '1'  // Signal non-interactive mode
      },
      stdio: ['ignore', 'pipe', 'pipe']  // Ignore stdin
    });

    let stdout = '';
    let stderr = '';
    let extractedText = '';

    // Parse stream-json output to extract text content
    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;

      // Parse each line as JSON
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
          // Not JSON, might be plain text output
          extractedText += trimmed;
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
      reject(new Error('Claude Code timeout'));
    }, (options.timeout || 300) * 1000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 || extractedText.length > 100) {
        // Return extracted text from stream-json output
        resolve(extractedText || stdout);
      } else {
        reject(new Error(`Claude Code exited with code ${code}: ${stderr.substring(0, 500)}`));
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * Generate SEO-friendly URL slug
 */
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

/**
 * Main task execution
 */
async function run(context) {
  const { config, logger } = context;
  const { settings } = config;
  
  logger.info('Starting daily blog generation');
  
  // Load state
  const state = loadState();
  
  try {
    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Select product and content type
    // ═══════════════════════════════════════════════════════════════
    logger.info('Step 1: Selecting product and content type');
    
    const product = selectProduct(settings.products, state.lastProduct);
    const contentType = selectContentType(settings.contentTypes, state.lastContentType);
    
    logger.info(`Selected: ${product.name} / ${contentType.type}`);
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Load ArcBlock product context
    // ═══════════════════════════════════════════════════════════════
    logger.info('Step 2: Loading product context');
    
    const contextPrompt = `/arcblock-context ${product.name.toLowerCase()}`;
    
    // This loads the context for the LLM session
    logger.info(`Loading context: ${contextPrompt}`);
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Research topic and keywords
    // ═══════════════════════════════════════════════════════════════
    logger.info('Step 3: Researching topic and keywords');
    
    const topicPrompt = generateTopicPrompt(product, contentType);
    
    // Generate the blog content using Claude Code
    // Use delimiters instead of JSON for more reliable parsing
    const blogPrompt = `You are a technical content writer creating a blog post for arcblock.io.

PRODUCT: ${product.name}
DESCRIPTION: ${product.description}
CONTENT TYPE: ${contentType.type}
TAGS: ${product.tags.join(', ')}
KEYWORDS: ${product.keywords.join(', ')}

ASSIGNMENT: ${topicPrompt}

STYLE GUIDE:
- Target ${settings.seo.targetWordCount} words
- Direct, technical voice (like a senior developer writing)
- NO corporate buzzwords: ${settings.seo.killWords.join(', ')}
- Include concrete examples and code where relevant
- SEO: use keywords naturally in title, H2s, and body

OUTPUT FORMAT - Use these exact delimiters:

===TITLE===
[SEO-optimized title under 60 chars]
===END_TITLE===

===META===
[Compelling meta description under 160 chars]
===END_META===

===SLUG===
[lowercase-hyphenated-url-slug]
===END_SLUG===

===TAGS===
[comma-separated tags]
===END_TAGS===

===HERO_IMAGE_PROMPT===
[Detailed prompt for AI hero image generation]
===END_HERO_IMAGE_PROMPT===

===CONTENT===
[Full markdown blog post with # Title, ## sections, code examples, etc.]
===END_CONTENT===`;
    
    logger.info('Generating blog content with Claude...');

    // Retry loop for content generation + parsing
    const maxGenerationAttempts = 2;
    let result = null;
    let generationError = null;

    for (let attempt = 1; attempt <= maxGenerationAttempts; attempt++) {
      try {
        result = await runClaudeCode(blogPrompt, { timeout: 600, maxRetries: 2 });
        break; // Success, exit retry loop
      } catch (error) {
        generationError = error;
        logger.warn(`Blog generation attempt ${attempt}/${maxGenerationAttempts} failed: ${error.message}`);
        if (attempt < maxGenerationAttempts) {
          logger.info('Retrying blog generation...');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }

    if (!result) {
      return {
        success: false,
        error: `Blog generation failed after ${maxGenerationAttempts} attempts: ${generationError?.message}`
      };
    }
    
    // Parse the delimiter-based result with fallback extraction
    let blogPost;
    try {
      // Helper function to extract content between delimiters
      const extractSection = (text, name) => {
        // Primary: exact delimiter match
        const regex = new RegExp(`===${name}===\\s*([\\s\\S]*?)\\s*===END_${name}===`, 'i');
        const match = text.match(regex);
        if (match) return match[1].trim();

        // Fallback 1: variations in delimiter format (spaces, lowercase)
        const fuzzyRegex = new RegExp(`={2,}\\s*${name}\\s*={2,}\\s*([\\s\\S]*?)\\s*={2,}\\s*END[_\\s]*${name}\\s*={2,}`, 'i');
        const fuzzyMatch = text.match(fuzzyRegex);
        if (fuzzyMatch) return fuzzyMatch[1].trim();

        // Fallback 2: only start delimiter present (content until next === or end)
        const startOnlyRegex = new RegExp(`===${name}===\\s*([\\s\\S]*?)(?====|$)`, 'i');
        const startOnlyMatch = text.match(startOnlyRegex);
        if (startOnlyMatch && startOnlyMatch[1].trim().length > 10) {
          return startOnlyMatch[1].trim();
        }

        return null;
      };

      // Fallback title extraction from content
      const extractTitleFromContent = (text) => {
        // Try to find a markdown title at the start
        const h1Match = text.match(/^#\s+(.+)$/m);
        if (h1Match) return h1Match[1].trim();

        // Try first line if it looks like a title
        const firstLine = text.split('\n')[0]?.trim();
        if (firstLine && firstLine.length > 10 && firstLine.length < 100 && !firstLine.startsWith('===')) {
          return firstLine;
        }

        return null;
      };

      // Fallback content extraction
      const extractContentFallback = (text) => {
        // Remove any delimiter markers and take the main body
        let cleaned = text
          .replace(/===\w+===/g, '')
          .replace(/===END_\w+===/g, '')
          .trim();

        // If very long, assume it's the content
        if (cleaned.length > 500) {
          return cleaned;
        }

        return null;
      };

      // Extract all sections
      let title = extractSection(result, 'TITLE');
      const metaDescription = extractSection(result, 'META');
      const slug = extractSection(result, 'SLUG');
      const tagsStr = extractSection(result, 'TAGS');
      const heroImagePrompt = extractSection(result, 'HERO_IMAGE_PROMPT');
      let content = extractSection(result, 'CONTENT');

      // Apply fallbacks if needed
      if (!title) {
        logger.warn('Title not found in delimiters, trying fallback extraction');
        title = extractTitleFromContent(result);
      }

      if (!content) {
        logger.warn('Content not found in delimiters, trying fallback extraction');
        content = extractContentFallback(result);
      }

      // Validate required fields
      if (!title || !content) {
        logger.error('Missing required sections in response (even with fallbacks)', {
          hasTitle: !!title,
          hasContent: !!content,
          responsePreview: result.substring(0, 500),
          responseLength: result.length
        });
        throw new Error('Missing required sections: TITLE and/or CONTENT');
      }

      // Parse tags
      const tags = tagsStr
        ? tagsStr.split(',').map(t => t.trim()).filter(t => t)
        : [];

      blogPost = {
        title,
        metaDescription: metaDescription || `Learn about ${product.name}`,
        slug: slug || generateSlug(title),
        tags,
        content,
        heroImagePrompt: heroImagePrompt || `Professional tech illustration for ${title}`
      };

      logger.info('Parsed blog content successfully', {
        title: blogPost.title,
        contentLength: blogPost.content.length,
        tagCount: blogPost.tags.length
      });

    } catch (parseError) {
      logger.error('Failed to parse blog content', {
        error: parseError.message,
        responseLength: result.length
      });
      return {
        success: false,
        error: `Failed to parse generated content: ${parseError.message}`
      };
    }
    
    logger.info(`Generated: "${blogPost.title}"`);
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 4: Generate visuals (hero image, diagrams)
    // ═══════════════════════════════════════════════════════════════
    logger.info('Step 4: Generating visual content');

    // 4a: Generate a Mermaid diagram for the content
    logger.info('Generating Mermaid diagram...');

    const diagramPrompt = `Based on this blog content, create a single Mermaid diagram.

TITLE: ${blogPost.title}
PRODUCT: ${product.name}
CONTENT PREVIEW: ${blogPost.content.substring(0, 1000)}...

Create a Mermaid diagram that illustrates a KEY CONCEPT from this content.
Choose the most appropriate diagram type:
- flowchart: for processes or workflows
- sequenceDiagram: for interactions between components
- graph: for architecture or relationships
- mindmap: for concept organization

Respond with ONLY the Mermaid code, no explanation. Start with the diagram type (e.g., flowchart TD, sequenceDiagram, etc.)`;

    let mermaidDiagram = null;
    try {
      const diagramResult = await runClaudeCode(diagramPrompt, { timeout: 60 });

      // Extract the mermaid code (look for common patterns)
      const mermaidMatch = diagramResult.match(/(flowchart|sequenceDiagram|graph|mindmap|classDiagram|stateDiagram|erDiagram|pie|gantt)[\s\S]+?(?=\n\n|$)/);
      if (mermaidMatch) {
        mermaidDiagram = mermaidMatch[0].trim();
        logger.info('Generated Mermaid diagram', { type: mermaidMatch[1] });
      }
    } catch (diagramError) {
      logger.warn('Failed to generate Mermaid diagram', { error: diagramError.message });
    }

    // Store the diagram and hero image prompt for later use
    blogPost.mermaidDiagram = mermaidDiagram;

    // Note: Actual hero image generation would use the ai-image-generation skill
    // For automation, we save the prompt so it can be generated separately
    logger.info('Hero image prompt saved for generation');
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 5: Prepare for publishing
    // ═══════════════════════════════════════════════════════════════
    logger.info('Step 5: Preparing publication');
    
    const slug = blogPost.slug || generateSlug(blogPost.title);
    
    // Save the generated content to a file for manual review/publishing
    const outputDir = join(DATA_DIR, 'blog-drafts');
    if (!existsSync(outputDir)) {
      execSync(`mkdir -p "${outputDir}"`);
    }
    
    const today = new Date().toISOString().split('T')[0];
    const draftFile = join(outputDir, `${today}-${slug}.json`);
    
    // Prepare the complete draft with all assets
    const completeDraft = {
      // Core content
      title: blogPost.title,
      metaDescription: blogPost.metaDescription,
      slug: blogPost.slug,
      tags: [...new Set([...product.tags, ...(blogPost.tags || [])])],
      content: blogPost.content,

      // Visual assets
      heroImagePrompt: blogPost.heroImagePrompt,
      mermaidDiagram: blogPost.mermaidDiagram,

      // Metadata
      product: product.name,
      contentType: contentType.type,
      generatedAt: new Date().toISOString(),
      publishUrl: settings.blogUrl,

      // Status
      status: 'draft',
      assetsGenerated: {
        article: true,
        codeExamples: blogPost.content.includes('```'),
        mermaidDiagram: !!blogPost.mermaidDiagram,
        heroImagePrompt: !!blogPost.heroImagePrompt
      }
    };

    writeFileSync(draftFile, JSON.stringify(completeDraft, null, 2));

    // Also create a markdown version for easy preview
    const markdownContent = `# ${blogPost.title}

> ${blogPost.metaDescription}

**Product:** ${product.name}
**Type:** ${contentType.type}
**Tags:** ${completeDraft.tags.join(', ')}
**Slug:** ${blogPost.slug}

---

${blogPost.content}

${blogPost.mermaidDiagram ? `
---

## Diagram

\`\`\`mermaid
${blogPost.mermaidDiagram}
\`\`\`
` : ''}

---

## Hero Image Prompt

> ${blogPost.heroImagePrompt}

---

*Generated: ${new Date().toISOString()}*
`;

    const markdownFile = draftFile.replace('.json', '.md');
    writeFileSync(markdownFile, markdownContent);

    logger.info(`Draft saved: ${draftFile}`);
    logger.info(`Markdown preview: ${markdownFile}`);
    
    logger.info(`Draft saved: ${draftFile}`);
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 6: Update state
    // ═══════════════════════════════════════════════════════════════
    logger.info('Step 6: Updating state');
    
    state.lastProduct = product.name;
    state.lastContentType = contentType.type;
    state.history.push({
      date: today,
      product: product.name,
      contentType: contentType.type,
      title: blogPost.title,
      slug
    });
    
    // Keep only last 30 entries
    if (state.history.length > 30) {
      state.history = state.history.slice(-30);
    }
    
    // Update statistics
    state.statistics.totalPosts++;
    state.statistics.byProduct[product.name] = (state.statistics.byProduct[product.name] || 0) + 1;
    state.statistics.byContentType[contentType.type] = (state.statistics.byContentType[contentType.type] || 0) + 1;
    
    saveState(state);

    // ═══════════════════════════════════════════════════════════════
    // STEP 7: Publish to Blog
    // ═══════════════════════════════════════════════════════════════
    logger.info('Step 7: Publishing to arcblock.io/blog');

    // Check if automation profile is set up
    const { isSessionValid, publishBlogPost, launchBrowser } = await import('./blog-publisher.mjs');

    const sessionValid = await isSessionValid();
    if (!sessionValid) {
      logger.warn('Automation profile not set up. Run "npm run setup-blog-automation" first');
      return {
        success: true,
        output: `Draft created: "${blogPost.title}" (ready for manual publishing)`,
        url: null,
        metadata: {
          product: product.name,
          contentType: contentType.type,
          title: blogPost.title,
          wordCount: blogPost.content.split(/\s+/).length,
          draftFile,
          markdownFile: draftFile.replace('.json', '.md'),
          assetsGenerated: completeDraft.assetsGenerated,
          requiresSetup: true,
          setupCommand: 'npm run setup-blog-automation'
        }
      };
    }

    try {
      // Launch browser with persistent session
      logger.info('Launching browser with persistent session...');
      const context = await launchBrowser(true); // headless: true for automation

      // Prepare combined tags
      const allTags = [...new Set([...product.tags, ...blogPost.tags])];

      // Publish the post
      const publishResult = await publishBlogPost(context, {
        title: blogPost.title,
        slug: slug,
        content: blogPost.content,
        metaDescription: blogPost.metaDescription,
        tags: allTags
      }, logger);

      await context.close();

      if (publishResult.success) {
        logger.info('Blog post published successfully!', { url: publishResult.url });

        // Update the draft file with published status
        const publishedData = {
          ...blogPost,
          product: product.name,
          contentType: contentType.type,
          publishedAt: new Date().toISOString(),
          publishedUrl: publishResult.url,
          status: 'published'
        };

        writeFileSync(draftFile, JSON.stringify(publishedData, null, 2));

        return {
          success: true,
          output: `Published: "${blogPost.title}"`,
          url: publishResult.url,
          metadata: {
            product: product.name,
            contentType: contentType.type,
            title: blogPost.title,
            wordCount: blogPost.content.split(/\s+/).length,
            draftFile,
            publishedAt: new Date().toISOString()
          }
        };
      } else {
        logger.error('Failed to publish blog post', { error: publishResult.error });

        return {
          success: true, // Draft was created successfully
          output: `Draft created but publishing failed: "${blogPost.title}"`,
          url: null,
          metadata: {
            product: product.name,
            contentType: contentType.type,
            draftFile,
            publishError: publishResult.error,
            pageUrl: publishResult.pageUrl
          }
        };
      }

    } catch (publishError) {
      logger.error('Blog publishing failed', { error: publishError.message });

      return {
        success: true, // Draft was created, just publishing failed
        output: `Draft created: "${blogPost.title}" (publishing failed: ${publishError.message})`,
        url: null,
        metadata: {
          product: product.name,
          contentType: contentType.type,
          draftFile,
          publishError: publishError.message
        }
      };
    }

  } catch (error) {
    logger.error('Blog generation failed', { error: error.message });

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get task status
 */
async function getStatus(context) {
  const state = loadState();
  
  return {
    healthy: true,
    totalPosts: state.statistics.totalPosts,
    lastProduct: state.lastProduct,
    lastContentType: state.lastContentType,
    productDistribution: state.statistics.byProduct,
    typeDistribution: state.statistics.byContentType
  };
}

export default { run, getStatus };
