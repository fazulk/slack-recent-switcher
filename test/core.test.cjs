const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Recents, Cycle, conversationFromURL, labelFromTitle, deepLink } = require('../src/core.cjs');
const conversation = id => conversationFromURL(`https://app.slack.com/client/T123/${id}`);

test('accepts Slack channels, DMs, group DMs and thread routes, rejects unrelated pages', () => {
  for (const id of ['C123', 'D456', 'G789']) assert.equal(conversation(id).channel, id);
  assert.equal(conversationFromURL('https://app.slack.com/client/T123/C123/thread/C123-123').key, 'T123/C123');
  for (const url of ['https://evilslack.com/client/T123/C123', 'https://slack.com.evil.org/client/T123/C123', 'https://app.slack.com/client/T123/threads', 'file:///client/T123/C123', 'garbage']) assert.equal(conversationFromURL(url), null);
});
test('recency, labels, workspaces and persistence remain distinct', () => {
  const r = new Recents();
  r.visit(conversation('C123'), '(3) general (Channel) - Acme - Slack');
  r.visit(conversation('D456'), 'Alex - Acme - Slack');
  r.visit(conversation('C123'));
  assert.deepEqual(r.items.map(x => x.label), ['general', 'Alex']);
  r.rename(conversation('D456'), 'Alex Updated - Acme - Slack');
  assert.equal(r.items[0].channel, 'C123');
  assert.equal(r.items[1].label, 'Alex Updated');
  assert.equal(new Recents(r.items).items.length, 2);
  assert.equal(new Recents([null, {}, ...r.items, r.items[0]]).items.length, 2);
  assert.deepEqual(labelFromTitle('(1) design - planning (Channel) - Acme - Slack', 'C123'), { label: 'design - planning', workspace: 'Acme' });
  assert.deepEqual(labelFromTitle('! general (Channel) - Acme - 2 new items - Slack', 'C123'), { label: 'general', workspace: 'Acme' });
  assert.deepEqual(labelFromTitle('Sam Rivera (DM) - Acme - 1 new item - Slack', 'D123'), { label: 'Sam Rivera', workspace: 'Acme' });
  const legacy = new Recents([{ ...conversation('C123'), label: 'general (Channel) - Acme', workspace: '2 new items' }]);
  assert.equal(legacy.items[0].label, 'general');
  assert.equal(legacy.items[0].workspace, 'Acme');
});
test('Cmd-K picks the previous conversation, cycles without reordering, wraps and reverses', () => {
  const r = new Recents();
  for (const id of ['C111', 'D222', 'G333']) r.visit(conversation(id));
  const cycle = new Cycle(r.snapshot('T123/G333'), 'T123/G333');
  assert.equal(cycle.selected.channel, 'D222');
  cycle.step(1); assert.equal(cycle.selected.channel, 'C111');
  cycle.step(1); assert.equal(cycle.selected.channel, 'G333');
  cycle.step(-1); assert.equal(cycle.selected.channel, 'C111');
  r.visit(conversation('C444'));
  assert.equal(cycle.items.length, 3);
  assert.equal(new Cycle(r.snapshot('T123/C444'), 'T123/C444', true).selected.channel, 'C111');
});
test('empty and single-item histories are safe; switching from a nonconversation picks newest', () => {
  const empty = new Cycle([], null); empty.step(1); assert.equal(empty.selected, null);
  const r = new Recents(); r.visit(conversation('C123'));
  assert.equal(new Cycle(r.items, 'T123/C123').selected.channel, 'C123');
  assert.equal(new Cycle(r.items, undefined).selected.channel, 'C123');
  assert.equal(deepLink(r.items[0]), 'slack://channel?team=T123&id=C123');
});
