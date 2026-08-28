import * as fs from 'fs';
import * as path from 'path';

const localesDir = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const outputPath = path.join(__dirname, '..', 'src', 'i18n', 'resources.generated.json');

function buildResources(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    fs.readdirSync(localesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .map((locale) => [
        locale,
        Object.fromEntries(
          fs.readdirSync(path.join(localesDir, locale))
            .filter((file) => file.endsWith('.json'))
            .sort()
            .map((file) => [
              path.basename(file, '.json'),
              JSON.parse(fs.readFileSync(path.join(localesDir, locale, file), 'utf8')) as unknown,
            ]),
        ),
      ]),
  );
}

const generated = `${JSON.stringify(buildResources(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  if (current !== generated) {
    console.error('Generated i18n resources are stale. Run: npm run i18n:generate');
    process.exit(1);
  }
} else {
  fs.writeFileSync(outputPath, generated);
}
