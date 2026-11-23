'use strict';

const fs = require('node:fs');
const path = require('node:path');

class FakeElement {
  constructor(id, tag, doc) {
    this._doc = doc || null;
    this.id = id;
    this.tagName = tag;
    this._innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.className = '';
    this.attrs = {};
    this.dataset = {};
    this.listeners = {};
  }
  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(v) {
    this._innerHTML = String(v);
    if (this._doc && this._doc._registerIds) {
      this._doc._registerIds(this._innerHTML);
    }
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
    return this.attrs[k] === undefined ? null : this.attrs[k];
  }
}

function scanIds(doc, html) {
  const tagRe = /<([a-zA-Z0-9]+)\b([^>]*)>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[1].toUpperCase();
    const attrsBlob = m[2];
    const idMatch = /\bid="([^"]+)"/.exec(attrsBlob);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (doc.els[id]) continue;
    const el = new FakeElement(id, tag, doc);
    const attrRe = /([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g;
    let am;
    while ((am = attrRe.exec(attrsBlob))) {
      const name = am[1];
      const val = am[2];
      if (name === 'id') continue;
      if (name === 'class') el.className = val;
      else if (name === 'value') el.value = val;
      else el.setAttribute(name, val);
    }
    doc.els[id] = el;
  }
}

function createFakeDocument(htmlPath) {
  const html = fs.readFileSync(htmlPath || path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const doc = {
    els: {},
    _registerIds(h) {
      scanIds(doc, h);
    },
    getElementById(id) {
      return doc.els[id] || null;
    }
  };
  scanIds(doc, html);
  return doc;
}

module.exports = { createFakeDocument, FakeElement };
