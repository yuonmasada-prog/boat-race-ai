const { readFileSync } = require('node:fs');

const model = JSON.parse(readFileSync('model/model.json', 'utf8'));
const manifest = JSON.parse(readFileSync('model/production-manifest.json', 'utf8'));
const featureCount = Array.isArray(model.features) ? model.features.length : 0;

if (!model.version || manifest.active !== model.version) {
  throw new Error(
    `Production manifest mismatch: manifest=${manifest.active || '-'} model=${model.version || '-'}`
  );
}

for (const field of ['mean', 'scale', 'coefficients']) {
  if (!Array.isArray(model[field]) || model[field].length !== featureCount) {
    throw new Error(`Model ${field} dimension mismatch`);
  }

  if (!model[field].every(value => Number.isFinite(Number(value)))) {
    throw new Error(`Model ${field} contains a non-finite value`);
  }
}

console.log(`Model contract OK: ${model.version} (${featureCount} features)`);
