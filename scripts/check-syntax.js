const { execFileSync } = require('node:child_process');
const { readdirSync, readFileSync, writeFileSync, unlinkSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  });
}

const files = [
  ...readdirSync('api').filter(file => file.endsWith('.js')).map(file => join('api', file)),
  ...javascriptFiles('lib'),
  'history.js'
];

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

const html = readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(Boolean);

if (!scripts.length) throw new Error('index.html inline script not found');

const temporary = join(tmpdir(), `boat-race-ai-index-${process.pid}.js`);
writeFileSync(temporary, scripts.join('\n'), 'utf8');

try {
  execFileSync(process.execPath, ['--check', temporary], { stdio: 'inherit' });
} finally {
  unlinkSync(temporary);
}

console.log(`Syntax OK: ${files.length} JavaScript files and index.html`);
