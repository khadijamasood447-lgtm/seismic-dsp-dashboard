﻿﻿﻿﻿﻿﻿﻿﻿﻿// scripts/copy-web-ifc-wasm.cjs
const fs = require('fs');
const path = require('path');

console.log('📦 Copying web-ifc WASM files...');

try {
  const source = require.resolve('web-ifc/web-ifc.wasm');
  const dest = path.join(process.cwd(), 'public', 'web-ifc.wasm');
  
  if (!fs.existsSync(path.dirname(dest))) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
  }
  
  fs.copyFileSync(source, dest);
  console.log('✅ web-ifc.wasm copied successfully');
} catch (error) {
  console.warn('⚠️ Could not copy web-ifc.wasm:', error.message);
}
