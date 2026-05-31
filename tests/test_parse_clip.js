const assert = require('assert');
const path = require('path');

// Mock electron before any imports.
const mockBrowserWindow = function() {
  return {
    webContents: {
      executeJavaScript: async () => {
        throw new Error('no render in test');
      },
    },
    on: () => {},
    loadFile: async () => {},
    setSize: () => {},
    isDestroyed: () => false,
    destroy: () => {},
  };
};

require('module')._cache[require.resolve('electron')] = {
  exports: {
    BrowserWindow: mockBrowserWindow,
    app: {
      getPath: () => '/tmp',
      getAppPath: () => process.cwd(),
    },
  },
};

const { PdfParser } = require('../dist-electron/services/pdf-parser');

function summarize(blocks) {
  const byType = {};
  const byPolicy = {};

  for (const block of blocks) {
    byType[block.type] = (byType[block.type] || 0) + 1;
    byPolicy[block.translationPolicy] = (byPolicy[block.translationPolicy] || 0) + 1;
  }

  return { byType, byPolicy };
}

function assertAllSkipped(blocks, type) {
  const matching = blocks.filter((block) => block.type === type);
  assert(matching.length > 0, `expected at least one ${type} block`);
  assert(
    matching.every((block) => block.translationPolicy === 'skip'),
    `expected every ${type} block to be skipped`
  );
}

function printVerbose(blocks, summary) {
  console.log(`\n=== TOTAL BLOCKS: ${blocks.length} ===\n`);

  console.log('By type:');
  for (const [type, count] of Object.entries(summary.byType).sort()) {
    console.log(`  ${type}: ${count}`);
  }

  console.log('\nBy translationPolicy:');
  for (const [policy, count] of Object.entries(summary.byPolicy).sort()) {
    console.log(`  ${policy}: ${count}`);
  }

  console.log('\n=== ALL BLOCKS ===');
  for (const block of blocks) {
    const status =
      block.translationPolicy === 'translate' ? 'T' : block.translationPolicy === 'skip' ? 'S' : 'A';
    const preview = block.en.substring(0, 80).replace(/\n/g, ' ');
    console.log(
      `[${status}] [${String(block.order).padStart(3)}] [${block.type.padEnd(15)}] ` +
        `[score=${String(block.quality.score).padStart(3)}] [p${block.page}] ${preview}`
    );
    if (block.skipReason) {
      console.log(`      skip: ${block.skipReason}`);
    }
  }
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  const explicitPdfPath = process.argv.find((arg) => arg.endsWith('.pdf'));
  const pdfPath = explicitPdfPath || path.join(process.cwd(), 'sample', 'clip.pdf');

  const parser = new PdfParser();
  const blocks = await parser.parse(pdfPath);
  const summary = summarize(blocks);
  const translateCount = summary.byPolicy.translate || 0;

  assert(blocks.length >= 2500 && blocks.length <= 3000, `unexpected block count: ${blocks.length}`);
  assert(
    translateCount >= 250 && translateCount <= 450,
    `unexpected translate-policy count: ${translateCount}`
  );

  for (const type of ['title', 'abstract', 'heading', 'paragraph']) {
    assert(summary.byType[type] > 0, `expected at least one ${type} block`);
  }

  assert(summary.byType.figure_asset > 0, 'expected at least one figure asset');
  assert(summary.byType.table_asset > 0, 'expected at least one table asset');
  assertAllSkipped(blocks, 'reference');
  assertAllSkipped(blocks, 'figure_body');
  assertAllSkipped(blocks, 'table_body');

  if (verbose) {
    printVerbose(blocks, summary);
  } else {
    console.log(
      `Parser smoke passed: ${blocks.length} blocks, ${translateCount} translate-policy blocks.`
    );
  }
}

main().catch((error) => {
  console.error('Parser smoke failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
