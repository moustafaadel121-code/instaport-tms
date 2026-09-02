/**
 * InstaPort TMS — Build Script
 * Level 1: Minify + Obfuscate  → dist/index.html
 * Level 2: Server-side SA auth → server.js + .env
 * Run: node build.js
 */

const fs   = require('fs');
const path = require('path');

async function build() {
  console.log('🔨 InstaPort TMS Build\n');

  // ── Read source ───────────────────────────────
  let src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  // ── License injection (--license <key>) ───────
  const licIdx = process.argv.indexOf('--license');
  const licKey = licIdx > -1 ? (process.argv[licIdx + 1] || '') : '';
  if (licKey) {
    if (!src.includes("var _LICENSE='';")) {
      console.error('❌ _LICENSE anchor not found in index.html');
      process.exit(1);
    }
    src = src.replace("var _LICENSE='';", "var _LICENSE='" + licKey + "';");
    console.log('🔑 License key embedded (domain-locked build)');
  } else {
    console.log('ℹ️  No --license flag → dev build (localhost/github.io only)');
  }

  // ── Level 1a: Minify CSS blocks ───────────────
  console.log('🎨 Minifying CSS…');
  const CleanCSS = require('clean-css');
  const css = new CleanCSS({ level: 2 });

  // Only minify the document-head styles: JS strings later in the file also
  // contain <style>…</style> (print windows) and must not be touched.
  const firstScript = src.search(/<script[\s>]/);
  let head = src.slice(0, firstScript), tail = src.slice(firstScript);
  head = head.replace(/<style>([\s\S]*?)<\/style>/gi, function(_, block) {
    const result = css.minify(block);
    if (result.errors && result.errors.length) {
      console.warn('  CSS warning:', result.errors);
    }
    return '<style>' + result.styles + '</style>';
  });
  let out = head + tail;
  console.log('  ✅ CSS minified');

  // ── Level 1b: Obfuscate JS blocks ─────────────
  console.log('⚙️  Obfuscating JavaScript…');
  const { minify } = require('terser');

  // Collect all <script> blocks and replace
  const scriptRe = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  const replacements = [];
  while ((match = scriptRe.exec(out)) !== null) {
    const attrs   = match[1] || '';
    const code    = match[2];
    // Skip external scripts (src="...") and empty blocks
    if (attrs.includes('src=') || !code.trim()) continue;
    replacements.push({ index: match.index, length: match[0].length, attrs, code });
  }

  // Process in reverse so indexes stay valid
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { index, length, attrs, code } = replacements[i];
    try {
      const result = await minify(code, {
        compress: {
          drop_console: false,   // keep console.warn for debugging
          passes: 2,
        },
        mangle: {
          // Keep public API names that are called from HTML onclick=""
          reserved: [
            'doLogin','doRegister','logout','nav','toggleDark','toggleLang',
            'openM','closeM','toast','can','planCan','buildSB',
            'showUpgradeModal','fillD','showLogin','showRegister',
            '_saFgChange','_saFgSave','_saFgReset','_saShowCreateInvite',
            '_saToggleInvite','_saAllTenants','_saAllInvites','_saUpdateTenant',
            'rSA_Overview','rSA_Orgs','rSA_Invites','rSA_Revenue','rSA_Features',
            'verifyPwd','requirePwd','audit',
          ],
          toplevel: false,
        },
        format: { comments: false },
      });
      const minified = '<script' + attrs + '>' + result.code + '</script>';
      out = out.slice(0, index) + minified + out.slice(index + length);
    } catch (e) {
      console.error('  ❌ JS block FAILED to obfuscate:', e.message, '@line', e.line);
      const _ls = code.split('\n');
      for (let _li = (e.line || 1) - 2; _li <= (e.line || 1); _li++)
        if (_ls[_li - 1] !== undefined) console.error('    ' + _li + ': ' + _ls[_li - 1].slice(0, 160));
      console.error('  Aborting — never ship a readable build.');
      process.exit(1);
    }
  }
  console.log('  ✅ JavaScript obfuscated');

  // ── Write dist/ ───────────────────────────────
  if (!fs.existsSync(path.join(__dirname, 'dist'))) {
    fs.mkdirSync(path.join(__dirname, 'dist'));
  }
  fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), out, 'utf8');

  const origKB = Math.round(Buffer.byteLength(src,   'utf8') / 1024);
  const distKB = Math.round(Buffer.byteLength(out,   'utf8') / 1024);
  const saved  = Math.round((1 - distKB / origKB) * 100);

  console.log(`\n📦 Output: dist/index.html`);
  console.log(`   Original : ${origKB} KB`);
  console.log(`   Minified : ${distKB} KB  (${saved}% smaller)`);
  console.log('\n✅ Level 1 build complete!\n');

  // ── Copy assets to dist/ ──────────────────────
  // Images only need copying once; sw.js and manifest.json are code and must
  // be refreshed every build, or the browser keeps serving an old worker.
  ['truck.png','truck-widget.png','logo.png'].forEach(function(f) {
    const src = path.join(__dirname, f);
    const dst = path.join(__dirname, 'dist', f);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      console.log('  Copied', f);
    }
  });

  // ── Service worker: always fresh, and cache-busted per build ───
  // The cache name carries the build stamp, so activating a new worker
  // deletes every cache from an older build instead of serving from it.
  const stamp = (src.match(/IP_BUILD\s*=\s*'([^']*)'/) || [])[1] || String(Date.now());
  // Record the stamp for the server, so /api/version reports it exactly
  // rather than guessing it out of minified code.
  fs.writeFileSync(path.join(__dirname, 'dist', 'build.json'),
    JSON.stringify({ build: stamp, at: new Date().toISOString() }, null, 2), 'utf8');
  console.log('  build.json →', stamp);
  const swSrc = path.join(__dirname, 'sw.js');
  if (fs.existsSync(swSrc)) {
    let sw = fs.readFileSync(swSrc, 'utf8');
    sw = sw.replace(/const CACHE = '[^']*';/, "const CACHE = 'instaport-" + stamp.replace(/[^A-Za-z0-9.-]+/g, '-') + "';");
    fs.writeFileSync(path.join(__dirname, 'dist', 'sw.js'), sw, 'utf8');
    console.log('  sw.js  → cache instaport-' + stamp.replace(/[^A-Za-z0-9.-]+/g, '-'));
  }
  ['manifest.json'].forEach(function(f) {
    const s2 = path.join(__dirname, f);
    if (fs.existsSync(s2)) {
      fs.copyFileSync(s2, path.join(__dirname, 'dist', f));
      console.log('  Refreshed', f);
    }
  });
}

build().catch(function(e) {
  console.error('Build failed:', e);
  process.exit(1);
});
