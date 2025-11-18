const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isDev = process.argv.includes('--dev');

// Ensure dist directory exists
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist', { recursive: true });
}

// Copy index.html to dist
fs.copyFileSync('public/index.html', 'dist/index.html');

const buildOptions = {
  entryPoints: ['src/index.jsx'],
  bundle: true,
  outfile: 'dist/bundle.js',
  minify: !isDev,
  sourcemap: isDev,
  loader: {
    '.js': 'jsx',
    '.jsx': 'jsx',
  },
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"',
  },
};

if (isDev) {
  // Development mode with watch
  esbuild
    .context(buildOptions)
    .then((ctx) => {
      ctx.watch();
      console.log('👀 Watching for changes...');
      
      // Start a local server
      ctx.serve({
        servedir: 'dist',
        port: 3000,
      }).then(server => {
        console.log(`🚀 Server running at http://localhost:${server.port}`);
      });
    })
    .catch(() => process.exit(1));
} else {
  // Production build
  esbuild
    .build(buildOptions)
    .then(() => {
      console.log('✅ Build complete!');
    })
    .catch(() => process.exit(1));
}
