'use strict';

function shortcut(platform = process.platform) {
  const mac = platform === 'darwin';
  return {
    modifier: mac ? 'meta' : 'control',
    key: mac ? 'Meta' : 'Control',
    label: mac ? '⌘' : 'Ctrl',
    isChord(input) {
      return !!input[mac ? 'meta' : 'control'] && !input[mac ? 'control' : 'meta'] && !input.alt &&
        (input.code === 'KeyK' || input.key?.toLowerCase() === 'k');
    },
    isRelease(input) {
      return input.type === 'keyUp' && (input.key === this.key || new RegExp(`^${this.key}(?:Left|Right)$`).test(input.code));
    },
    menuPattern: mac ? 'command|cmd|commandorcontrol|cmdorctrl|super' : 'control|ctrl|commandorcontrol|cmdorctrl'
  };
}

module.exports = { shortcut };
