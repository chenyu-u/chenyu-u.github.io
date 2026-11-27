// tools/shell.mjs · stamps the shared header, office tab and footer into every page.
// Each page marks the spots with   <!-- shell:header --> … <!-- /shell:header -->
//                                  <!-- shell:footer --> … <!-- /shell:footer -->
// and names itself on <body data-page="work"> so its link is marked as the current page.
// story.html writes its own header by hand (it adds the sound button and chapter place); keep its links in step.
// Run after changing a link:   node tools/shell.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = [
  ['work', 'projects.html', 'Projects'],
  ['experience', 'experience.html', 'Experience'],
  ['life', 'life.html', 'Life'],
  ['resume', 'resume.html', 'Resume'],
];
const ICON = {
  mail: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m3 6.5 9 6.5 9-6.5"/></svg>',
  linkedin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
  github: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>',
  laptop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>',
};

export const socialIcons = `<div class="bar-social">
      <a href="mailto:info.chenyuli@gmail.com" aria-label="Email" title="Email">${ICON.mail}</a>
      <a href="https://linkedin.com/in/li-chenyu" target="_blank" rel="noopener" aria-label="LinkedIn" title="LinkedIn">${ICON.linkedin}</a>
      <a href="https://github.com/chenyu-u" target="_blank" rel="noopener" aria-label="GitHub" title="GitHub">${ICON.github}</a>
    </div>`;

const header = (page) => `<header class="site-bar" id="bar">
  <a class="site-name" href="index.html">Chenyu Li</a>
  <nav class="site-nav" id="site-nav" aria-label="Pages"><ul>
${PAGES.map(([id, href, label]) => `    <li><a href="${href}"${id === page ? ' aria-current="page"' : ''}>${label}</a></li>`).join('\n')}
  </ul></nav>
  <div class="bar-tools">
    ${socialIcons}
    <div data-prefs-slot></div>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Menu"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 8h16M4 16h16"/></svg></button>
  </div>
</header>
<a class="office-tab" href="laptop.html">${ICON.laptop}<span>My office</span></a>`;

const footer = (variant) => `<footer class="site-foot${variant ? ' ' + variant + '-foot' : ''}"><div class="wrap">
  <div class="foot-main">
    <h2>Say hello</h2>
    <a class="foot-mail" href="mailto:info.chenyuli@gmail.com">info.chenyuli@gmail.com</a>
    <p>I'm looking for an internship or co-op from May to August 2027, and a 12 to 16 month Professional Experience Year starting in May 2028. <a href="resume.html#request">Request my resume</a></p>
  </div>
  <div class="foot-cols">
    <ul>
      <li><a href="index.html">Home</a></li>
${PAGES.map(([, href, label]) => `      <li><a href="${href}">${label}</a></li>`).join('\n')}
    </ul>
    <ul>
      <li><a href="https://linkedin.com/in/li-chenyu" target="_blank" rel="noopener">LinkedIn</a></li>
      <li><a href="https://github.com/chenyu-u" target="_blank" rel="noopener">GitHub</a></li>
      <li><a href="https://hab.civmin.utoronto.ca/people/chenyu-li/" target="_blank" rel="noopener">Research group</a></li>
    </ul>
    <ul>
      <li><a href="story.html">Follow the wind, a 3D story</a></li>
      <li><a href="laptop.html">My office in 3D</a></li>
      <li><a href="robot-sim.html">Robotic arm simulator</a></li>
    </ul>
  </div>
  <p class="foot-small">© 2026 Chenyu Li, Toronto</p>
</div></footer>`;

let n = 0;
for (const f of readdirSync(root).filter((f) => f.endsWith('.html'))) {
  const p = join(root, f), src = readFileSync(p, 'utf8');
  if (!src.includes('<!-- shell:')) continue;
  const page = (src.match(/<body[^>]*data-page="([^"]+)"/) || [])[1] || '';
  const out = src
    .replace(/<!-- shell:header -->[\s\S]*?<!-- \/shell:header -->/, `<!-- shell:header -->\n${header(page)}\n<!-- /shell:header -->`)
    .replace(/<!-- shell:footer( \w+)? -->[\s\S]*?<!-- \/shell:footer -->/, (m, v) => `<!-- shell:footer${v || ''} -->\n${footer(v ? v.trim() : '')}\n<!-- /shell:footer -->`);
  if (out !== src) { writeFileSync(p, out); n++; console.log('stamped', f); }
}
console.log(n, 'page(s) updated');
