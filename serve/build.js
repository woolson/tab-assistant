// Do this as the first thing so that any code reading it knows the right env.
process.env.BABEL_ENV = 'production';
process.env.NODE_ENV = 'production';
process.env.ASSET_PATH = '/';

var webpack = require('webpack'),
  config = require('../webpack.config');

delete config.chromeExtensionBoilerplate;

config.mode = 'production';

webpack(config, function (err, stats) {
  if (err) {
    console.error(err.stack || err);
    process.exitCode = 1;
    return;
  }

  console.log(stats.toString({
    colors: true,
    preset: 'errors-warnings',
  }));

  if (stats.hasErrors()) {
    process.exitCode = 1;
  }
});
