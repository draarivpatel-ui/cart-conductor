'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const fontsCss = fs.readFileSync(path.join(root, 'fonts.css'), 'utf8');
const allCss = fontsCss + '\n' + css;
const printableCss = css.slice(css.indexOf('@media print'));
const scripts = ['app.js', 'engine.js', 'saga-lab.js']
  .map((rel) => fs.readFileSync(path.join(root, rel), 'utf8')).join('\n');

function attrsOf(raw) {
  const out = {};
  for (const m of raw.matchAll(/([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)) {
    let value = m[2] || '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[m[1].toLowerCase()] = value;
  }
  return out;
}
const allTags = [...html.matchAll(/<([a-z][\w-]*)\b([^<>]*)>/gi)]
  .map((m) => ({ name: m[1].toLowerCase(), attrs: attrsOf(m[2]), raw: m[0] }));
const ids = allTags.flatMap((tag) => tag.attrs.id ? [tag.attrs.id] : []);

test('static DOM ids are unique and every ID reference resolves', () => {
  assert.equal(new Set(ids).size, ids.length, 'duplicate id values in index.html');
  const idSet = new Set(ids);
  for (const tag of allTags) {
    for (const attr of ['for', 'aria-controls', 'aria-describedby', 'aria-labelledby', 'aria-details']) {
      for (const id of (tag.attrs[attr] || '').split(/\s+/).filter(Boolean)) {
        assert.ok(idSet.has(id), `${tag.raw} references missing #${id}`);
      }
    }
  }
});

test('static controls have accessible names and non-submit buttons declare type', () => {
  const labelTargets = new Set(allTags.filter((tag) => tag.name === 'label' && tag.attrs.for).map((tag) => tag.attrs.for));
  for (const tag of allTags) {
    if (['input', 'select', 'textarea'].includes(tag.name) && tag.attrs.type !== 'hidden') {
      assert.ok(tag.attrs['aria-label'] || tag.attrs['aria-labelledby'] || labelTargets.has(tag.attrs.id),
        `${tag.raw} has no accessible label`);
    }
    if (tag.name === 'button') assert.equal(tag.attrs.type, 'button', `${tag.raw} must not implicitly submit`);
  }
});

test('HTML and CSS local assets exist and no runtime asset comes from a CDN', () => {
  for (const tag of allTags) {
    const attr = tag.name === 'script' ? 'src' : tag.name === 'link' ? 'href' : tag.name === 'img' ? 'src' : null;
    const url = attr && tag.attrs[attr];
    if (!url || url.startsWith('data:') || url.startsWith('#')) continue;
    assert.doesNotMatch(url, /^(?:https?:)?\/\//i, `${tag.raw} is an external runtime dependency`);
    const clean = decodeURI(url.split(/[?#]/)[0]);
    assert.ok(fs.existsSync(path.resolve(root, clean)), `${url} does not exist`);
  }
  for (const m of allCss.matchAll(/\burl\(\s*['"]?([^)'"]+)['"]?\s*\)/gi)) {
    const url = m[1];
    assert.doesNotMatch(url, /^(?:https?:)?\/\//i, `${url} is an external CSS dependency`);
    if (!url.startsWith('data:') && !url.startsWith('#')) {
      assert.ok(fs.existsSync(path.resolve(root, decodeURI(url.split(/[?#]/)[0]))), `${url} does not exist`);
    }
  }
  assert.doesNotMatch(scripts, /https?:\/\/(?:cdn\.|unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(?:googleapis|gstatic)\.com)/i);
});

test('interactive controls use 3:1 boundaries and mobile controls reserve 44px targets', () => {
  assert.match(css, /--border-control: #767A7E/);
  assert.match(css, /\.field-input \{[\s\S]*?border: 1px solid var\(--border-control\)/);
  assert.match(css, /\.mode-card \{[\s\S]*?border: 1px solid var\(--border-control\)/);
  assert.match(css, /\.tab-btn \{[\s\S]*?border: 1px solid var\(--border-control\)/);
  const mobile = css.slice(css.indexOf('@media (max-width: 640px)'));
  assert.match(mobile, /\.field-input,\s*\.field-range,\s*\.analytics-control-row input\[type="range"\],\s*\.mode-card,\s*\.btn-primary,\s*\.tab-btn,\s*\.apply-btn\s*\{[^}]*min-width: 44px/);
  assert.match(mobile, /\.field-input,\s*\.field-range,\s*\.analytics-control-row input\[type="range"\],\s*\.mode-card,\s*\.btn-primary,\s*\.tab-btn,\s*\.apply-btn\s*\{[^}]*min-height: 44px/);
  assert.match(mobile, /\.field-range,\s*\.analytics-control-row input\[type="range"\]\s*\{[^}]*height: 44px/);
});

test('print stylesheet resets paper output and focus and motion contracts stay present', () => {
  assert.match(css, /@media print\b/);
  assert.match(css, /:focus-visible\b/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(printableCss, /\.control-panel \.controls-grid, \.control-panel \.mode-cards-row, \.saga-controls, \.lab-controls/);
  assert.match(printableCss, /button, input, select, textarea \{ display: none !important; \}/);
  assert.match(printableCss, /html, body \{ background: #fff !important; color: #111 !important; overflow: visible !important; \}/);
  assert.match(printableCss, /\.json-viewer \{ border: 1px solid #777; white-space: pre-wrap; word-break: break-word; \}/);
  assert.match(printableCss, /\.table-wrap, \.saga-timeline, \.lab-selftest-list, \.json-viewer, \.inspector-meta-bar \{ overflow: visible !important; max-height: none !important; \}/);
  assert.match(printableCss, /\.ledger-table \{ font-size: 8pt; break-inside: avoid-page; \}/);
});
