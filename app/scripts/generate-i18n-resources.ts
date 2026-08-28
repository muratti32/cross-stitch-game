import * as fs from 'fs';
import * as path from 'path';

const localesDir = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const outputPath = path.join(__dirname, '..', 'src', 'i18n', 'resources.generated.json');

export function buildResources(localesRoot: string = localesDir): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    fs.readdirSync(localesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .map((locale) => [
        locale,
        Object.fromEntries(
            fs.readdirSync(path.join(localesRoot, locale))
            .filter((file) => file.endsWith('.json'))
            .sort()
            .map((file) => [
              path.basename(file, '.json'),
            JSON.parse(fs.readFileSync(path.join(localesRoot, locale, file), 'utf8')) as unknown,
            ]),
        ),
      ]),
  );
}

export function generatedResourcesText(localesRoot: string = localesDir): string {
  return `${JSON.stringify(buildResources(localesRoot), null, 2)}\n`;
}

export function checkGeneratedResources(
  localesRoot: string = localesDir,
  generatedPath: string = outputPath,
): boolean {
  const current = fs.existsSync(generatedPath) ? fs.readFileSync(generatedPath, 'utf8') : '';
  return current === generatedResourcesText(localesRoot);
}

export function runGenerationCli(): void {
  const generated = generatedResourcesText();
  if (process.argv.includes('--check')) {
    if (!checkGeneratedResources()) {
      console.error('Generated i18n resources are stale. Run: npm run i18n:generate');
      process.exit(1);
    }
  } else {
    fs.writeFileSync(outputPath, generated);
  }
}

if (require.main === module) runGenerationCli();
