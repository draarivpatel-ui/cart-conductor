'use strict';

const fs = require('node:fs');
const path = require('node:path');

class FakeElement {
  constructor(id, tag) {
    this.id = id;
    this.tagName = tag;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.className = '';
    this.attrs = {};
    this.dataset = {};
    this.listeners = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  dispatch(type, evt) {
    (this.listeners[type] || []).forEach((fn) => fn(Object.assign({ target: this }, evt)));
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = v;
    }
  }
  getAttribute(k) {
    return this.attrs[k];
  }
}

function createFakeDocument(htmlPath) {
  const html = fs.readFileSync(htmlPath || path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const els = {};
  const tagRe = /<([a-z0-9]+)\b([^>]*)\bid="([^"]+)"([^>]*)>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[1].toUpperCase();
    const attrsBlob = m[2] + ' ' + m[4];
    const id = m[3];
    const el = new FakeElement(id, tag);
    const dataRe = /\b(data-[a-z0-9-]+|value)="([^"]*)"/gi;
    let dm;
    while ((dm = dataRe.exec(attrsBlob))) {
      if (dm[1] === 'value') {
        el.value = dm[2];
      } else {
        el.setAttribute(dm[1], dm[2]);
      }
    }
    els[id] = el;
  }
  return {
    els,
    getElementById(id) {
      return els[id] || null;
    }
  };
}

module.exports = { createFakeDocument, FakeElement };
