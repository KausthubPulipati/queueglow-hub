const test = require('node:test');
const assert = require('node:assert/strict');
const { MediaBridge } = require('../electron/media.cjs');

test('Windows transport commands update the media bridge for play/pause and track skips', async () => {
  const changes = [];
  const bridge = new MediaBridge('unused', (value) => changes.push(value));
  bridge.lyricsEnabled = false;
  const commands = [];
  let position = 0;
  bridge.request = async (action, seconds, options) => {
    commands.push({ action, seconds, options });
    if (action === 'next') position += 1;
    if (action === 'previous') position -= 1;
    return {
      media: {
        title: `Track ${position}`,
        artist: 'Queueglow test fixture',
        source: 'Queueglow test',
        playing: action !== 'playPause',
        position: 0,
        duration: 180,
      },
      volume: 50,
      system: null,
    };
  };

  await bridge.control('playPause');
  await bridge.control('next');
  await bridge.control('previous');

  assert.deepEqual(
    commands.map(({ action }) => action),
    ['playPause', 'next', 'previous'],
  );
  assert.equal(bridge.media.title, 'Track 0');
  assert.equal(bridge.media.playing, true);
  assert.equal(changes.length, 3);
});
