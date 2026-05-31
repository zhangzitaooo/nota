const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const ts = require('typescript');

const testDocumentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-reading-workbench-'));

require('module')._cache[require.resolve('electron')] = {
  exports: {
    BrowserWindow: function() {},
    app: {
      getPath: (name) => (name === 'documents' ? testDocumentsDir : os.tmpdir()),
      getAppPath: () => process.cwd(),
    },
  },
};

function loadTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf-8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const mod = new Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  mod._compile(output, filePath);
  return mod.exports;
}

function assertThrowsInvalid(fn, label) {
  assert.throws(fn, /非法|Invalid/, label);
}

async function testProjectStorePathGuard() {
  const { ProjectStore } = require('../dist-electron/services/project-store');
  const store = new ProjectStore();

  assertThrowsInvalid(() => store.resolveProjectDir(''), 'empty project ID should be rejected');
  assertThrowsInvalid(() => store.resolveProjectDir('../escape'), 'path traversal should be rejected');
  assertThrowsInvalid(() => store.resolveProjectDir('/tmp/escape'), 'absolute project ID should be rejected');
  assertThrowsInvalid(() => store.resolveProjectDir('bad/id'), 'path separator should be rejected');
  assertThrowsInvalid(
    () => store.resolveProjectAsset('safe-project', '../source.pdf'),
    'asset traversal should be rejected'
  );
  assertThrowsInvalid(
    () => store.resolveProjectAsset('safe-project', '/tmp/source.pdf'),
    'absolute asset path should be rejected'
  );

  const projectDir = store.resolveProjectDir('safe-project');
  assert(projectDir.startsWith(testDocumentsDir), 'safe project should resolve under test documents dir');
}

function testAnnotationOverlapRenderer() {
  const { renderBlockHtml } = loadTypeScriptModule(path.join(process.cwd(), 'src/domain/utils.ts'));
  const block = {
    id: 'block-1',
    type: 'paragraph',
    sectionPath: [],
    order: 1,
    en: 'Hello world',
    zh: '重叠标注文本',
    status: 'done',
  };
  const annotations = [
    {
      id: 'highlight-1',
      blockId: 'block-1',
      type: 'highlight',
      start: 0,
      end: 4,
      selectedText: '重叠标注',
      createdAt: '2026-05-31T00:00:00.000Z',
      updatedAt: '2026-05-31T00:00:00.000Z',
    },
    {
      id: 'bold-1',
      blockId: 'block-1',
      type: 'bold',
      start: 2,
      end: 6,
      selectedText: '标注文本',
      createdAt: '2026-05-31T00:00:00.000Z',
      updatedAt: '2026-05-31T00:00:00.000Z',
    },
  ];

  const html = renderBlockHtml(block, annotations);
  const plainText = html.replace(/<[^>]+>/g, '');

  assert.strictEqual(plainText, block.zh, 'annotation overlap should not duplicate rendered text');
  assert(html.includes('annotation-highlight'), 'expected highlight markup');
  assert(html.includes('annotation-bold'), 'expected bold markup');
}

async function testDisabledWebSearch() {
  const { WebSearchTool } = require('../dist-electron/services/tools/web-search-tool');
  const tool = new WebSearchTool();
  const result = await tool.execute(
    { query: 'CLIP paper homepage' },
    {
      paperTitle: 'Learning Transferable Visual Models From Natural Language Supervision',
      selectedText: 'CLIP',
      question: '官网是什么？',
    }
  );

  assert.strictEqual(result.toolName, 'web_search');
  assert.strictEqual(result.ok, false);
  assert(result.content.includes('没有可用的搜索 provider'), 'expected unavailable-provider message');
}

async function main() {
  await testProjectStorePathGuard();
  testAnnotationOverlapRenderer();
  await testDisabledWebSearch();
  console.log('Health tests passed.');
}

main().catch((error) => {
  console.error('Health tests failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
