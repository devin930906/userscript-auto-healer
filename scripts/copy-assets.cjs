'use strict';
const { copyFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const target = join(__dirname, '..', 'dist', 'app', 'ui');
mkdirSync(target, { recursive: true });
copyFileSync(join(__dirname, '..', 'app', 'ui', 'index.html'), join(target, 'index.html'));
