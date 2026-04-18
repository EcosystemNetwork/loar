/**
 * Custom Metro transformer.
 *
 * Wraps Expo's default Metro babel transformer and additionally applies a
 * custom plugin that rewrites `import.meta` (unsupported by Hermes) to an
 * empty object literal. thirdweb (redux-devtools-extension) and brotli_wasm
 * ship published ESM code that reads `import.meta.env` / `import.meta.url`;
 * Hermes refuses to compile those expressions so we strip them at bundle time.
 *
 * The replacement is benign:
 *   import.meta.env → ({}).env → undefined  (used only for Vite-mode checks)
 *   import.meta.url → ({}).url → undefined  (only lazy brotli_wasm path)
 */
const upstreamTransformer = require('@expo/metro-config/babel-transformer');
const { transformSync } = require('@babel/core');

function replaceImportMetaPlugin({ types: t }) {
  return {
    name: 'replace-import-meta',
    visitor: {
      MetaProperty(path) {
        if (path.node.meta.name === 'import' && path.node.property.name === 'meta') {
          path.replaceWith(t.objectExpression([]));
        }
      },
    },
  };
}

const fs = require('fs');
module.exports.transform = async function transform({ src, filename, options }) {
  let transformedSrc = src;
  if (src.includes('import.meta')) {
    fs.appendFileSync('/tmp/metro-transform.log', `HIT: ${filename}\n`);
    try {
      const result = transformSync(src, {
        filename,
        babelrc: false,
        configFile: false,
        sourceType: 'unambiguous',
        plugins: [replaceImportMetaPlugin],
      });
      if (result && result.code) {
        transformedSrc = result.code;
      }
    } catch {
      // Fall through — upstream transformer will surface the parse error.
    }
  }
  return upstreamTransformer.transform({ src: transformedSrc, filename, options });
};
