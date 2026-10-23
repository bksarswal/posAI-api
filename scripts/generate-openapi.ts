import fs from 'node:fs';
import path from 'node:path';
import '../src/app.js';
import { getOpenAPIDocument } from '../src/config/openapi.js';

const document = getOpenAPIDocument();
const outputPath = path.resolve(process.cwd(), 'openapi.json');

fs.writeFileSync(outputPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
console.log(`✅ OpenAPI 3.1 specification written to ${outputPath}`);
