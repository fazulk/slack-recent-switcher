'use strict';

// Serialized into the renderer. Shadow DOM prevents Slack CSS from altering the switcher.
module.exports = function renderSwitcher(state) {
  const id = 'slack-recent-switcher-overlay';
  let host = document.getElementById(id);
  if (!state) { host?.remove(); return; }
  if (!host) {
    host = document.createElement('div');
    host.id = id;
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      *{box-sizing:border-box} :host{color-scheme:light dark}
      .backdrop{position:fixed;inset:0;background:rgba(16,14,22,.20);display:flex;align-items:center;justify-content:center;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#24202d}
      .panel{width:min(520px,calc(100vw - 48px));border:1px solid rgba(255,255,255,.5);border-radius:18px;background:#faf9fc;box-shadow:0 24px 90px #0005;overflow:hidden}
      .head{padding:21px 22px 15px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e7e3ed}
      h2{margin:0;font-size:16px;font-weight:650;letter-spacing:-.2px}.count{font-size:12px;color:#807789}
      .query-slot{height:48px;margin:14px 20px 6px;border:1px solid #7fc4bc;border-radius:9px;background:#ffffff08;position:relative}
      .placeholder{position:absolute;left:13px;top:14px;color:#817788;font-size:14px}
      .list{max-height:min(420px,50vh);overflow:auto;padding:8px}
      .row{display:flex;gap:12px;align-items:center;border-radius:10px;padding:11px 12px;margin:2px 0}
      .row[aria-selected=true]{background:#0f766e;color:white}
      .icon{width:32px;height:32px;border-radius:9px;background:#e3f0ee;display:grid;place-items:center;font-size:18px;font-weight:600;flex-shrink:0;color:#3f7f79}
      .row[aria-selected=true] .icon{background:#ffffff22;color:white}
      .name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.info{min-width:0;flex:1}
      .workspace{font-size:12px;color:#817788;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row[aria-selected=true] .workspace{color:#d5f3ef}
      .unread{flex-shrink:0;font-size:11px;font-weight:650;padding:2px 8px;border-radius:999px;background:#0f766e;color:white}
      .row[aria-selected=true] .unread{background:white;color:#0f766e}
      .current{font-size:11px;opacity:.6}.empty{padding:26px 15px;color:#817788;text-align:center;line-height:1.6}
      .footer{padding:13px 20px;border-top:1px solid #e7e3ed;display:flex;justify-content:space-between;font-size:11px;color:#817788}
      @media(prefers-color-scheme:dark){.unread{background:#0d857b}.row[aria-selected=true] .unread{color:#0d857b}.panel{background:#211e27;color:#f3eff8;border-color:#ffffff18}.head,.footer{border-color:#ffffff13}.icon{background:#ffffff0c;color:#7fd0c6}.workspace,.count,.footer{color:#a49aac}.row[aria-selected=true]{background:#0d857b}}
      @media(prefers-reduced-transparency:no-preference){.panel{backdrop-filter:blur(24px)}}
    `;
    const backdrop = document.createElement('div'); backdrop.className = 'backdrop';
    const panel = document.createElement('section'); panel.className = 'panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Recent conversations');
    const head = document.createElement('div'); head.className = 'head';
    const heading = document.createElement('h2'); heading.textContent = 'Recent conversations';
    const count = document.createElement('span'); count.className = 'count';
    head.append(heading, count);
    const list = document.createElement('div'); list.className = 'list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Recent conversations');
    const footer = document.createElement('div'); footer.className = 'footer';
    const hint = document.createElement('span'); hint.textContent = 'Hold ⌘ · K next · ⇧K previous';
    const release = document.createElement('span'); release.textContent = 'Release ⌘ to open · Esc cancel';
    const query = document.createElement('div'); query.className = 'query-slot'; query.hidden = true;
    const placeholder = document.createElement('span'); placeholder.className = 'placeholder'; placeholder.textContent = 'Search channels, people, files, and more…'; query.append(placeholder);
    footer.append(hint, release); panel.append(head, query, list, footer); backdrop.append(panel); root.append(style, backdrop); document.documentElement.append(host);
  }
  const root = host.shadowRoot;
  const modifier = state.modifier || '⌘';
  host.style.zIndex = state.search ? '2147483646' : '2147483647';
  host.style.pointerEvents = state.search ? 'auto' : 'none';
  root.querySelector('.query-slot').hidden = !state.search;
  root.querySelector('.placeholder').hidden = !!state.query;
  root.querySelector('h2').textContent = state.search && state.query ? 'Search Slack' : state.unreadOnly ? 'Unread conversations' : 'Recent conversations';
  root.querySelector('.panel').setAttribute('aria-label', state.search ? 'Search Slack' : 'Recent conversations');
  root.querySelector('.footer span:first-child').textContent = state.search ? `${modifier}+K next · Shift+${modifier}+K previous` : `Hold ${modifier} · K next · Shift+K previous`;
  root.querySelector('.footer span:last-child').textContent = state.search ? `Enter to open · ${state.tab ? `Tab ${state.tab === 'unread' ? 'unread only' : 'show all'} · ` : ''}Esc cancel` : `Release ${modifier} to open · Esc cancel`;
  root.querySelector('.count').textContent = state.items.length ? state.index < 0 ? `${state.items.length} results` : `${state.index + 1} / ${state.items.length}` : '';
  const list = root.querySelector('.list'); list.replaceChildren();
  if (!state.items.length) {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = state.query ? 'No suggestions yet. Press Enter to search Slack.' : state.unreadOnly ? 'No unread conversations.' : 'Visit a channel or direct message to start your recent list.'; list.append(empty);
  }
  state.items.forEach((item, index) => {
    const row = document.createElement('div'); row.className = 'row'; row.id = `recent-${index}`; row.dataset.index = index; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === state.index));
    const icon = document.createElement('span'); icon.className = 'icon'; icon.textContent = item.icon || (item.channel?.startsWith('D') ? '@' : '#'); icon.setAttribute('aria-hidden', 'true');
    const info = document.createElement('div'); info.className = 'info';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = item.label;
    info.append(name);
    const detail = item.workspace || (item.icon ? '' : item.team) || '';
    if (detail) { const workspace = document.createElement('div'); workspace.className = 'workspace'; workspace.textContent = detail; info.append(workspace); }
    row.append(icon, info);
    if (item.unread) { const unread = document.createElement('span'); unread.className = 'unread'; unread.textContent = item.count ? `Unread · ${item.count}` : 'Unread'; row.append(unread); }
    if (item.key === state.currentKey) { const current = document.createElement('span'); current.className = 'current'; current.textContent = 'Current'; row.append(current); }
    list.append(row);
  });
  list.setAttribute('aria-activedescendant', `recent-${state.index}`);
  root.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
};
