import { readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the failure matrix
const matrixPath = join(process.cwd(), 'test', 'browser', 'e2e', 'failure_matrix.json');
const matrix = JSON.parse(readFileSync(matrixPath, 'utf-8')) as Array<{
  id: string;
  layer: string;
  injection: string;
  expected: string;
  severity: string;
}>;

const errorCatalogPath = join(__dirname, '../../../../../.gemini/antigravity-ide/brain/a65c779c-cb70-4e70-acc1-784068df1497/docs/audits/FULL_E2E_ERROR_CATALOG.md');

function logResult(entry: any, actual: string, recoveredUI: boolean, recoveredSession: boolean, fixStatus: string) {
  const line = `| ${entry.id} | ${entry.layer} | ${entry.injection} | ${entry.expected} | ${actual} | ${entry.severity} | No | ${recoveredUI ? 'Yes' : 'No'} | ${recoveredSession ? 'Yes' : 'No'} | ${fixStatus} | ${fixStatus} |\n`;
  appendFileSync(errorCatalogPath, line);
}

console.log('Starting Failure Injection E2E tests...');

for (const entry of matrix) {
  console.log(`\nRunning injection ${entry.id}: ${entry.injection}`);
  try {
    // Set environment variable so the system can detect the injection point
    const env = { ...process.env, FAIL_INJECTION_ID: entry.id };
    // Execute the standard session E2E test suite
    execSync('npm run test:session-e2e', { stdio: 'inherit', env, cwd: process.cwd() });
    // If we reach here, test passed – likely no failure observed
    logResult(entry, 'PASS (no failure triggered)', true, true, 'Not needed');
  } catch (err) {
    // Capture error output
    const output = (err as any).stdout?.toString() || (err as any).message;
    // Determine if UI or session recovered by simple heuristics (placeholder)
    const recoveredUI = output.includes('UI recovered') || output.includes('error handled');
    const recoveredSession = output.includes('session resumed') || output.includes('session recovered');
    logResult(entry, `FAIL: ${output.split('\n')[0]}`, recoveredUI, recoveredSession, 'Pending');
  }
}

console.log('Failure Injection tests completed.');
