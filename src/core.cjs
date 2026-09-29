'use strict';

const MAX_RECENTS = 30;

function conversationFromURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/(^|\.)slack\.com$/.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/client\/([TE][A-Z0-9]+)\/([CDG][A-Z0-9]+)(?:\/|$)/);
    if (!match) return null;
    const [, team, channel] = match;
    return { key: `${team}/${channel}`, team, channel };
  } catch { return null; }
}

function labelFromTitle(title, channel) {
  const clean = title.replace(/^\s*(?:\(\d+\)|[!•●])\s*/, '')
    .replace(/\s*[-–—|]\s*Slack\s*$/, '')
    .replace(/\s*[-–—|]\s*\d+\s+new\s+items?\s*$/i, '').trim();
  // Slack titles: "name (Channel) - Workspace - Slack" or "Person - Workspace - Slack".
  const parts = clean.split(/\s+[-–—|]\s+/);
  const workspace = parts.length > 1 ? parts.pop() : '';
  const label = parts.join(' - ').replace(/\s*\((?:Channel|DM|Direct Message)\)\s*$/i, '').trim();
  return { label: label && label !== 'Slack' ? label : channel, workspace };
}

class Recents {
  constructor(saved = []) {
    const seen = new Set();
    this.items = (Array.isArray(saved) ? saved : []).filter(item => {
      if (!item || !/^[TE][A-Z0-9]+$/.test(item.team) || !/^[CDG][A-Z0-9]+$/.test(item.channel)) return false;
      if (item.key !== `${item.team}/${item.channel}` || seen.has(item.key)) return false;
      if (typeof item.label !== 'string' || typeof item.workspace !== 'string') return false;
      seen.add(item.key);
      return true;
    }).slice(0, MAX_RECENTS).map(item => {
      // Repair titles saved by 0.1, before Slack's unread suffix was recognized.
      if (/^\d+ new items?$/i.test(item.workspace)) {
        return { ...item, ...labelFromTitle(`${item.label} - ${item.workspace} - Slack`, item.channel) };
      }
      return item;
    });
  }
  visit(conversation, title = '') {
    const old = this.items.find(item => item.key === conversation.key);
    const label = title ? labelFromTitle(title, conversation.channel) : old ?? { label: conversation.channel, workspace: '' };
    const item = { ...conversation, label: label.label, workspace: label.workspace };
    this.items = [item, ...this.items.filter(other => other.key !== item.key)].slice(0, MAX_RECENTS);
  }
  rename(conversation, title) {
    const item = this.items.find(item => item.key === conversation.key);
    if (item && title) Object.assign(item, labelFromTitle(title, conversation.channel));
  }
  snapshot(currentKey) {
    const items = this.items.map(item => ({ ...item }));
    const index = items.findIndex(item => item.key === currentKey);
    if (index > 0) items.unshift(...items.splice(index, 1));
    return items;
  }
}

class Cycle {
  constructor(items, currentKey, reverse = false) {
    this.items = items;
    this.index = Math.max(0, items.findIndex(item => item.key === currentKey));
    if (items.length && items.some(item => item.key === currentKey)) this.step(reverse ? -1 : 1);
  }
  step(delta) {
    if (this.items.length) this.index = (this.index + delta + this.items.length) % this.items.length;
  }
  get selected() { return this.items[this.index] ?? null; }
}

function deepLink(item) {
  return `slack://channel?team=${encodeURIComponent(item.team)}&id=${encodeURIComponent(item.channel)}`;
}

module.exports = { Recents, Cycle, conversationFromURL, labelFromTitle, deepLink };
