const identifier = '[\\w$]+';

function replaceExactly(source, pattern, replacement, expected, label) {
  let count = 0;
  const patched = source.replace(pattern, (...args) => {
    count++;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
  if (count !== expected) throw new Error(`Unsupported Slack search code: ${label} (expected ${expected}, found ${count}).`);
  return patched;
}

export function patchSearch(source) {
  if (!source.includes('renderBlankSlateSuggestions(){') || !source.includes('function historyEntriesToSuggestions(')) return null;
  const edits = [];
  const addEdit = (start, end, text) => edits.push({ start, end, text });

  const budgets = [...source.matchAll(new RegExp(`(${identifier})=(${identifier})\\.length>0\\?3:5`, 'g'))];
  if (budgets.length !== 2) throw new Error(`Unsupported Slack search code: expected two recent-place budgets, found ${budgets.length}.`);
  for (const budget of budgets) addEdit(budget.index, budget.index + budget[0].length, `${budget[1]}=8`);

  const recentLists = [...source.matchAll(new RegExp(`,(${identifier})=${identifier}\\?navigationEventsToSuggestions\\(`, 'g'))];
  if (recentLists.length !== 2) throw new Error('Unsupported Slack search code: recent-place builders changed.');
  for (const recent of recentLists) {
    const end = source.indexOf('unread_count_bucket:', recent.index);
    if (end < 0 || end - recent.index > 4000) throw new Error('Unsupported Slack search code: recent-place block changed.');
    const block = source.slice(recent.index, end);
    const unreads = block.match(new RegExp(`let (${identifier})=${identifier}\\.slice\\(0,10\\),(${identifier})=${identifier}\\.length>10\\?\\[\\{id:"unreads-toggle"`));
    if (!unreads) throw new Error('Unsupported Slack search code: unread list changed.');
    const order = `...${unreads[1]},...${unreads[2]},...${recent[1]}`;
    const replacement = `...${recent[1]},...${unreads[1]},...${unreads[2]}`;
    const reordered = replaceExactly(block, new RegExp(order.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement, 2, 'suggestion order');
    addEdit(recent.index, end, reordered);
  }

  const start = source.indexOf('renderBlankSlateSuggestions(){');
  const end = source.indexOf('renderSearchHeaderMegaphoneContainer(){', start);
  if (end < 0) throw new Error('Unsupported Slack search code: blank-state renderer changed.');
  let render = source.slice(start, end);
  const recentGroup = render.match(new RegExp(`let (${identifier})=(${identifier})&&${identifier}&&(${identifier})\\.length\\?`));
  const recentHeader = render.match(new RegExp(`label:(${identifier})\\.t\\("Recent places"\\),labelId:${identifier},isFirst:${identifier}&&!(${identifier})`));
  if (!recentGroup || !recentHeader) throw new Error('Unsupported Slack search code: section groups changed.');
  const [, recentElement, , recentItems] = recentGroup;
  const unreadElement = recentHeader[2];
  const dividerPattern = new RegExp(`${unreadElement}&&\\(0,(${identifier})\\.jsx\\)\\("li",\\{role:"presentation",className:"c-search_autocomplete__section_divider"\\}\\),`);
  const divider = render.match(dividerPattern);
  if (!divider) throw new Error('Unsupported Slack search code: section divider changed.');
  render = replaceExactly(render, dividerPattern, '', 1, 'old divider');
  const unreadHeader = new RegExp(`(label:${identifier}\\.t\\("Unreads & drafts"\\),labelId:${identifier},isFirst:)!0`);
  render = replaceExactly(render, unreadHeader, (_match, prefix) => `${prefix}!${recentItems}.length`, 1, 'unread header');
  render = replaceExactly(render, /label:([\w$]+)\.t\("Recent places"\),labelId:([\w$]+),isFirst:([\w$]+)&&!([\w$]+)/, (_match, translate, labelId) => `label:${translate}.t("Recent places"),labelId:${labelId},isFirst:!0`, 1, 'recent header');
  render = replaceExactly(render, new RegExp(`${recentItems}\\.slice\\(0,5\\)\\.map`, 'g'), `${recentItems}.slice(0,8).map`, 1, 'visible recents');
  const childrenPattern = /return\(0,[\w$]+\.jsxs\)\([\w$]+\.Fragment,\{children:\[([^\]]+)\]\}\)\}$/;
  render = replaceExactly(render, childrenPattern, (match, children) => {
    const nodes = children.split(',');
    const unreadIndex = nodes.indexOf(unreadElement);
    const recentIndex = nodes.indexOf(recentElement);
    if (unreadIndex < 0 || recentIndex <= unreadIndex) throw new Error('Unsupported Slack search code: section order changed.');
    nodes[unreadIndex] = recentElement;
    nodes[recentIndex] = `${recentElement}&&${unreadElement}&&(0,${divider[1]}.jsx)("li",{role:"presentation",className:"c-search_autocomplete__section_divider"}),${unreadElement}`;
    return match.replace(`children:[${children}]`, `children:[${nodes.join(',')}]`);
  }, 1, 'section order');
  addEdit(start, end, render);

  edits.sort((left, right) => right.start - left.start);
  for (let index = 0; index < edits.length - 1; index++) {
    if (edits[index + 1].end > edits[index].start) throw new Error('Slack patch edits overlap.');
  }
  let result = source;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
