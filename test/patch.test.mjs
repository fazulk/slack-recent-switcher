import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { patchSearch } from '../src/patch.mjs';

const source = readFileSync(new URL('./search.fixture.txt', import.meta.url), 'utf8');
const recent = Array.from({ length: 12 }, (_, index) => ({ id: `recent-${index}`, suggestion_sub_type: 'recent-places' }));
const unread = Array.from({ length: 15 }, (_, index) => ({ id: `unread-${index}`, suggestion_sub_type: 'unreads-and-drafts' }));
function fixture(code) {
  const context = {};
  runInNewContext(code, context);
  return context.fixture;
}
function descendants(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
}

test('unrelated scripts are left alone; changed Slack code is rejected before returning a patch', () => {
  assert.equal(patchSearch('console.log("another Slack module")'), null);
  assert.throws(() => patchSearch(source.replace('o=n.length>0?3:5', 'o=6')), /budgets/);
  assert.throws(() => patchSearch(source.replace('b.slice(0,5)', 'b.slice(0,6)')), /visible recents/);
  assert.throws(() => patchSearch(source.replace('children:[D,B]', 'children:[B,D]')), /section order/);
});

for (const builder of ['buildSync', 'buildRebuild']) {
  for (const huddle of [false, true]) {
    test(`${builder}: eight recents lead the native data with huddle=${huddle}`, () => {
      const original = fixture(source)[builder](unread, recent, huddle);
      assert.equal(original.filter(item => item.suggestion_sub_type === 'recent-places').length, 3);
      const patched = fixture(patchSearch(source))[builder](unread, recent, huddle);
      assert.deepEqual(Array.from(patched.slice(0, 8), item => item.id), recent.slice(0, 8).map(item => item.id));
      assert.deepEqual(Array.from(patched.slice(8, 18), item => item.id), unread.slice(0, 10).map(item => item.id));
      assert.equal(patched[18].type, 'unreadsToggle');
      if (huddle) assert.equal(patched.at(-1).type, 'huddle');
    });
  }
}

test('rendered section order, native selection indices and actions agree', () => {
  const { buildSync, SearchAutocomplete } = fixture(patchSearch(source));
  const suggestions = buildSync(unread, recent);
  const nodes = descendants(new SearchAutocomplete(suggestions).renderBlankSlateSuggestions());
  const headers = nodes.filter(node => node.type === 'header');
  assert.deepEqual(headers.map(node => node.props.label), ['Recent places', 'Unreads & drafts']);
  assert.deepEqual(headers.map(node => node.props.isFirst), [true, false]);
  const rows = nodes.filter(node => node.type === 'suggestion');
  assert.equal(rows.filter(row => row.props.suggestion.suggestion_sub_type === 'recent-places').length, 8);
  for (const [index, row] of rows.entries()) {
    assert.equal(row.props.index, index);
    assert.equal(row.props.onAccept(), suggestions[index]);
  }
  const divider = nodes.findIndex(node => node.props?.className === 'c-search_autocomplete__section_divider');
  assert.ok(divider > nodes.indexOf(headers[0]) && divider < nodes.indexOf(headers[1]));
});

test('empty groups and fewer than eight available recents remain valid', () => {
  const { buildSync, SearchAutocomplete } = fixture(patchSearch(source));
  for (const [unreads, recents, expected] of [[[], recent, ['Recent places']], [unread, [], ['Unreads & drafts']], [[], [], []], [[], recent.slice(0, 2), ['Recent places']]]) {
    const suggestions = buildSync(unreads, recents);
    const nodes = descendants(new SearchAutocomplete(suggestions).renderBlankSlateSuggestions());
    assert.deepEqual(nodes.filter(node => node.type === 'header').map(node => node.props.label), expected);
    assert.ok(nodes.filter(node => node.type === 'header').every(node => node.props.isFirst));
    assert.equal(nodes.filter(node => node.props?.className === 'c-search_autocomplete__section_divider').length, 0);
    assert.equal(suggestions.filter(item => item.suggestion_sub_type === 'recent-places').length, Math.min(8, recents.length));
  }
});
