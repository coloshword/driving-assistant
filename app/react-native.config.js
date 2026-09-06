const path = require('path');

module.exports = {
  dependencies: {
    'da-whisper': {
      root: path.resolve(__dirname, '../packages/whisper'),
      platforms: {
        ios: { podspecPath: path.resolve(__dirname, '../packages/whisper/ios/DAWhisper.podspec') },
        android: null,
      },
    },
    'da-kokoro': {
      root: path.resolve(__dirname, '../packages/kokoro'),
      platforms: {
        ios: { podspecPath: path.resolve(__dirname, '../packages/kokoro/ios/DAKokoro.podspec') },
        android: null,
      },
    },
  },
};
