import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const widgetDirectory = resolve(scriptDirectory, '..');
const repositoryDirectory = resolve(widgetDirectory, '..');

export const sourcePath = resolve(widgetDirectory, 'src', 'v1.js');
export const packagePath = resolve(widgetDirectory, 'package.json');

// Every copy of the widget that a visitor can be served has to be listed here.
// The Go binary embeds backend/internal/api/assets/widget.js with go:embed and
// serves it at /widget.js, which is the URL the embed snippet points at, so a
// build that refreshed only dist/v1.js never reached a single customer site.
export const outputPaths = [
  resolve(widgetDirectory, 'dist', 'v1.js'),
  resolve(repositoryDirectory, 'backend', 'internal', 'api', 'assets', 'widget.js')
];

export function renderWidget(source, version) {
  if (!source.includes('__GARUDA_VERSION__')) {
    throw new Error('Widget source is missing its version placeholder.');
  }
  if (/\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML\b|document\.write\b/.test(source)) {
    throw new Error('Unsafe HTML rendering primitive found in widget source.');
  }

  const banner = [
    '/*! Garuda Widget v' + version,
    ' * Dependency-free website assistant loader.',
    ' * Public agent keys identify published agents; session credentials stay in memory.',
    ' */',
    ''
  ].join('\n');

  // Line endings are normalized so that a Windows checkout and a Linux checkout
  // produce byte-identical output, which is what the drift check compares.
  const normalized = source.replace(/\r\n/g, '\n');
  return banner + normalized.replaceAll('__GARUDA_VERSION__', version);
}

export async function readWidgetVersion() {
  const packageJSON = JSON.parse(await readFile(packagePath, 'utf8'));
  return packageJSON.version;
}

export async function buildWidget() {
  const source = await readFile(sourcePath, 'utf8');
  const output = renderWidget(source, await readWidgetVersion());
  for (const outputPath of outputPaths) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, 'utf8');
  }
  return output;
}

const executedDirectly = Boolean(process.argv[1]) &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (executedDirectly) {
  const output = await buildWidget();
  const size = Buffer.byteLength(output).toLocaleString('en-US');
  for (const outputPath of outputPaths) {
    const label = relative(repositoryDirectory, outputPath).replaceAll('\\', '/');
    console.log('Built ' + label + ' (' + size + ' bytes)');
  }
}
