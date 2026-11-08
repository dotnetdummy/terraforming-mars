const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

// Makes the .vue file format parseable.
const {VueLoaderPlugin} = require('vue-loader');
// Compresses resources for smaller download.
const CompressionPlugin = require('compression-webpack-plugin');
// Speeds up typescript type checking into a separate process.
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
// Enables the tsconfig-paths behavior in webpack. tsconfig-paths is responsible for the
// import mapping that often begins with @.
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

const zlib = require('zlib');

const production = process.env.NODE_ENV === 'production';

// Writes build/index.html with the content-hashed bundle names.
// The script URLs have to change on every production build. Cloudflare caches
// the old names for hours, and a stable main.js mixed with a new chunk throws
// at startup because the module ids no longer match.
class IndexHtmlPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('IndexHtmlPlugin', (compilation) => {
      const entry = compilation.entrypoints.get('main');
      if (entry === undefined) {
        throw new Error('Missing main entrypoint');
      }
      const scripts = entry.getFiles().filter((file) => file.endsWith('.js'));
      const templatePath = path.resolve(__dirname, 'assets/index.html');
      const template = fs.readFileSync(templatePath, 'utf8');
      const scriptTags = scripts.map((file) => `<script src="${file}"></script>`).join('\n        ');
      const html = template.replace(
        /<script src="vendors\.js"><\/script>\s*<script src="main\.js"><\/script>/,
        scriptTags,
      );
      if (html === template) {
        throw new Error('assets/index.html is missing the vendors.js and main.js script tags');
      }
      fs.mkdirSync(compiler.outputPath, {recursive: true});
      fs.writeFileSync(path.join(compiler.outputPath, 'index.html'), html);
    });
  }
}

const plugins = [
  new ForkTsCheckerWebpackPlugin({
    typescript: {
      configOverwrite: {
        exclude: [
          'tests/**/*.ts',
        ],
      },
    },
  }),
  new VueLoaderPlugin(),
  new webpack.DefinePlugin({
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  }),
  {
    apply: (compiler) => {
      compiler.hooks.compile.tap('BuildStartPlugin', () => {
        console.log('🚀 Webpack Build Started...');
      });

      compiler.hooks.done.tap('BuildEndPlugin', () => {
        // Pushes the log to the very end of the execution queue
        process.nextTick(() => {
          console.log('✅ Webpack Build Finished!');
        });
      });
    },
  },
];

if (production) {
  plugins.push(new IndexHtmlPlugin());
  plugins.push(new CompressionPlugin());
  plugins.push(new CompressionPlugin({
    algorithm: 'brotliCompress',
    filename: '[path][base].br',
    compressionOptions: {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY}},
  }));
}

if (!production) {
  // Reports progress on the commandline during compilation.
  plugins.push(new webpack.ProgressPlugin());
}

module.exports = {
  devtool: 'source-map',
  mode: production ? 'production' : 'development',
  entry: {
    main: './src/client/main.ts',
    sw: './src/client/sw.ts',
  },
  resolve: {
    plugins: [new TsconfigPathsPlugin()],
    extensions: ['.ts', '.vue', '.js'],
    alias: {
      'vue$': 'vue/dist/vue.esm-bundler.js',
    },
  },
  module: {
    rules: [
      {
        test: /\.vue$/,
        loader: 'vue-loader',
      },
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        options: {
          appendTsSuffixTo: [/\.vue$/],
          transpileOnly: true,
          compilerOptions: {module: 'esnext', removeComments: false}
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', {loader: 'css-loader', options: {url: false}}],
      },
      {
        test: /\.less$/,
        use: ['style-loader', {loader: 'css-loader', options: {url: false}}, {
          loader: 'less-loader',
          options: {
            // Prepend the shared design tokens and mixins to every component's
            // <style lang="less"> block. This lets scoped components use
            // @variables (e.g. @player_red, @font_size_normal) and .mixins()
            // (e.g. .raised-bevel()) directly, without importing them.
            //
            // Only include files that contain declarations and mixins, not actual styles.
            additionalData: '@import "variables.less"; @import "mixins.less";',
            lessOptions: {
              paths: [path.resolve(__dirname, 'src/styles')],
            },
          },
        }],
      },
    ],
  },
  plugins,
  output: {
    path: __dirname + '/build',
    hashFunction: 'xxhash64',
    publicPath: '',
    // The service worker is registered at a fixed URL. Every other script name
    // includes its content hash so a deploy cannot pair a new runtime with an
    // old cached chunk.
    filename: (pathData) => {
      const name = pathData.chunk && pathData.chunk.name;
      if (!production || name === 'sw') {
        return '[name].js';
      }
      return '[name].[contenthash].js';
    },
    chunkFilename: production ? 'chunks/[name].[contenthash].js' : 'chunks/[name].js',
  },
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
        },
      },
    },
  },
};
