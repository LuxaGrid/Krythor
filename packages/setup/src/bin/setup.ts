#!/usr/bin/env node
import { SetupWizard } from '../SetupWizard.js';

new SetupWizard().run().catch(err => {
  console.error('\x1b[31mSetup failed:\x1b[0m', err instanceof Error ? err.message : err);
  process.exit(1);
});
