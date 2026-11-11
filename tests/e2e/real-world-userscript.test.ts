/**
 * TASK-021 / TEST-027 (Extended Real-World Validation)
 *
 * Real-world complex userscript AST parsing, fail-closed scope defense,
 * and end-to-end atomic manual export regression test.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { importDroppedBytes } from '../../src/import/import-service';
import { parseUserscriptMetadata, readUserscriptSource } from '../../src/analyze/metadata-parser';
import { analyzeSelectors } from '../../src/analyze/selector-analyzer';
import { proposeLiteralSelectorPatch, type LiteralPatchRequest } from '../../src/repair/patch-planner';
import { prepareManualRepairExportOnly } from '../../src/repair/manual-repair-flow';
import type { ScenarioInput } from '../../src/scenarios/scenario-registry';

const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

// Standard complex userscript fixture representing realistic ChatGPT userscript patterns
const REALISTIC_COMPLEX_FIXTURE = [
  '// ==UserScript==',
  '// @name ChatGPT Prompt Flow Live Fixture',
  '// @namespace https://devinooi.com/',
  '// @version 1.0.51',
  '// @match https://chatgpt.com/*',
  '// @grant GM_getValue',
  '// @grant GM_setValue',
  '// @grant GM_registerMenuCommand',
  '// @run-at document-idle',
  '// ==/UserScript==',
  '',
  'function setupQueue(queueList) {',
  '  if (!queueList) return;',
  '  // Local variable method call: must be blocked from unsafe document patching',
  '  const rows = queueList.querySelectorAll(".queue-row");',
  '  return rows.length;',
  '}',
  '',
  'function setupComposer() {',
  '  // Top-level document method call: valid target for conservative selector patch',
  '  const textarea = document.querySelector("#prompt-textarea");',
  '  if (textarea) {',
  '    textarea.placeholder = "Enter prompt...";',
  '  }',
  '  return textarea;',
  '}',
  '',
  'setupComposer();',
  ''
].join('\n');

const REPAIR_TARGET_FIXTURE = [
  '// ==UserScript==',
  '// @name ChatGPT Auto Enhancer',
  '// @namespace https://devinooi.com/',
  '// @version 1.0.0',
  '// @match https://chatgpt.com/*',
  '// @grant none',
  '// @run-at document-idle',
  '// ==/UserScript==',
  '',
  'function setupComposer() {',
  '  const textarea = document.querySelector("#prompt-textarea");',
  '  if (textarea) {',
  '    textarea.placeholder = "Enter prompt...";',
  '  }',
  '  return textarea;',
  '}',
  '',
  'setupComposer();',
  ''
].join('\n');

test('TEST-027: real-world userscript metadata, AST parsing and scope defense', () => {
  // If external workspace real-world script exists, load it; otherwise use the realistic complex fixture
  const candidateExternalPath = resolve(__dirname, '../../../../ChatGPT-Prompt-Flow.user.js');
  const rawBytes = existsSync(candidateExternalPath)
    ? readFileSync(candidateExternalPath)
    : Buffer.from(REALISTIC_COMPLEX_FIXTURE, 'utf8');

  const imported = importDroppedBytes('ChatGPT-Prompt-Flow.user.js', rawBytes);
  assert.ok(!('code' in imported), 'Script import must succeed without boundary violations');
  if ('code' in imported) return;

  assert.equal(imported.filename, 'ChatGPT-Prompt-Flow.user.js');
  assert.equal(imported.sha256, hash(rawBytes));

  // 1. Metadata verification
  const meta = parseUserscriptMetadata(imported);
  assert.equal(meta.status, 'OK');
  assert.ok(meta.tags.name && meta.tags.name.length > 0);
  assert.ok(meta.tags.match && meta.tags.match.length > 0);
  assert.ok(meta.tags.grant && meta.tags.grant.length > 0);

  // 2. AST parsing verification
  const source = readUserscriptSource(imported);
  assert.ok(source !== null, 'Source must decode successfully');
  if (source === null) return;

  const analysis = analyzeSelectors(source);
  assert.equal(analysis.status, 'OK');
  assert.ok(analysis.sites.length >= 2, 'AST should discover selector call sites');

  // 3. Fail-closed defense verification:
  // Any call on a non-document object (e.g. queueList.querySelectorAll) must be BLOCKED
  const queueRowSite = analysis.sites.find(s => s.selector === '.queue-row');
  if (queueRowSite && queueRowSite.selector) {
    const sourceSha256 = hash(source);
    const guardedRequest: LiteralPatchRequest = {
      source,
      expectedSourceSha256: sourceSha256,
      callOffset: queueRowSite.offset,
      method: queueRowSite.method as 'querySelectorAll',
      originalSelector: queueRowSite.selector,
      replacementSelector: '.new-queue-row',
      faultEvidenceId: 'guard_e2e_001'
    };
    const guardedResult = proposeLiteralSelectorPatch(guardedRequest);
    assert.equal(guardedResult.status, 'BLOCKED');
    assert.equal(guardedResult.reason, 'UNSUPPORTED_TARGET');
  }
});

test('TEST-027: end-to-end typical DOM failure repair, atomic backup and zero-corruption export', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uah-e2e-realworld-'));
  const backupDirectory = join(root, 'backups');
  const exportDirectory = join(root, 'manual-exports');
  const scriptPath = join(root, 'chatgpt-enhancer.user.js');

  try {
    await mkdir(backupDirectory);
    await mkdir(exportDirectory);
    await writeFile(scriptPath, REPAIR_TARGET_FIXTURE, 'utf8');

    const sourceSha256 = hash(REPAIR_TARGET_FIXTURE);
    const analysis = analyzeSelectors(REPAIR_TARGET_FIXTURE);
    assert.equal(analysis.status, 'OK');
    const composerSite = analysis.sites.find(s => s.selector === '#prompt-textarea');
    assert.ok(composerSite && composerSite.selector, 'Composer selector site must be detected');

    const patchRequest: LiteralPatchRequest = {
      source: REPAIR_TARGET_FIXTURE,
      expectedSourceSha256: sourceSha256,
      callOffset: composerSite.offset,
      method: composerSite.method as 'querySelector',
      originalSelector: composerSite.selector,
      replacementSelector: '#chat-composer-input',
      faultEvidenceId: 'scenario_assertion_1'
    };

    // 1. Verify conservative patch planning
    const patchResult = proposeLiteralSelectorPatch(patchRequest);
    assert.equal(patchResult.status, 'CANDIDATE_ONLY');
    if (patchResult.status !== 'CANDIDATE_ONLY') return;
    assert.equal(patchResult.automaticPatchAllowed, false);
    assert.equal(patchResult.tampermonkeyVerified, false);
    assert.equal(patchResult.change.before, '"#prompt-textarea"');
    assert.equal(patchResult.change.after, '"#chat-composer-input"');

    // 2. Scenario & observation setup with 2 confirmed samples
    const scenario: ScenarioInput = {
      id: 'chatgpt_composer_e2e',
      scriptSha256: sourceSha256,
      userApproved: true,
      requiresLogin: false,
      targetUrl: 'https://chatgpt.com/',
      steps: [],
      assertions: [
        { kind: 'selector-present', selector: '#prompt-textarea' },
        { kind: 'selector-present', selector: '#chat-composer-input' }
      ]
    };

    const observationSamples = {
      ok: true as const,
      status: 'LIMITED_DYNAMIC_OBSERVATION' as const,
      samples: [
        {
          ok: true as const,
          status: 'LIMITED_DOM_OBSERVATION' as const,
          observedAt: '2026-10-19T00:00:00Z',
          originMatchesApproved: true as const,
          routeChanged: false,
          summary: { elementCount: 88, iframeCount: 0, visibleShadowRoots: 0, blindSpots: [] },
          selectorCounts: { '#prompt-textarea': 0, '#chat-composer-input': 1 },
          fullPageVerified: false as const,
          userscriptVerified: false as const
        },
        {
          ok: true as const,
          status: 'LIMITED_DOM_OBSERVATION' as const,
          observedAt: '2026-10-19T00:00:01Z',
          originMatchesApproved: true as const,
          routeChanged: false,
          summary: { elementCount: 88, iframeCount: 0, visibleShadowRoots: 0, blindSpots: [] },
          selectorCounts: { '#prompt-textarea': 0, '#chat-composer-input': 1 },
          fullPageVerified: false as const,
          userscriptVerified: false as const
        }
      ],
      routeChangeDetected: false,
      selectorCountChanged: false,
      domCountChanged: false,
      userscriptVerified: false as const
    };

    // 3. Execute manual export flow
    const flowResult = await prepareManualRepairExportOnly(
      patchRequest,
      scenario,
      observationSamples,
      {
        sourcePath: scriptPath,
        backupDirectory,
        exportDirectory,
        userApproved: true
      }
    );

    assert.equal(flowResult.status, 'MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED');
    if (flowResult.status !== 'MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED') return;

    assert.ok(flowResult.backupFileName.includes('.backup.user.js'));
    assert.ok(flowResult.exportFileName.includes('.user.js'));
    assert.ok(flowResult.checkpointFileName.includes('.checkpoint.json'));
    assert.equal(flowResult.automaticPatchAllowed, false);

    // 4. Fail-closed assertion: original script MUST remain 100% untouched
    const diskSource = await readFile(scriptPath, 'utf8');
    assert.equal(diskSource, REPAIR_TARGET_FIXTURE, 'Original file must never be corrupted or overwritten');

    // 5. Candidate script contains replacement
    const exportedCandidate = await readFile(join(exportDirectory, flowResult.exportFileName), 'utf8');
    assert.ok(exportedCandidate.includes('#chat-composer-input'), 'Candidate script must contain repaired selector');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
