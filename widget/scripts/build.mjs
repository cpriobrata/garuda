import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const widgetDirectory = resolve(scriptDirectory, '..');
const sourcePath = resolve(widgetDirectory, 'src', 'v1.js');
const outputPath = resolve(widgetDirectory, 'dist', 'v1.js');
const packagePath = resolve(widgetDirectory, 'package.json');

const packageJSON = JSON.parse(await readFile(packagePath, 'utf8'));
const source = await readFile(sourcePath, 'utf8');

if (!source.includes('__GARUDA_VERSION__')) {
  throw new Error('Widget source is missing its version placeholder.');
}
if (/\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML\b|document\.write\b/.test(source)) {
  throw new Error('Unsafe HTML rendering primitive found in widget source.');
}

const banner = [
  '/*! Garuda Widget v' + packageJSON.version,
  ' * Dependency-free website assistant loader.',
  ' * Public agent keys identify published agents; session credentials stay in memory.',
  ' */',
  ''
].join('\n');

const output = banner + source.replaceAll('__GARUDA_VERSION__', packageJSON.version);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, 'utf8');

console.log('Built dist/v1.js (' + Buffer.byteLength(output).toLocaleString('en-US') + ' bytes)');
