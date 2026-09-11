// 统一测试入口：运行 tests 目录下所有 *.test.js，聚合结果。
// 运行: npm test  （或 node tests/run-all.js）

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.test.js'))
  .sort();

let failed = 0;

for (const file of files) {
  process.stdout.write(`\n=== ${file} ===\n`);
  try {
    const out = execFileSync('node', [path.join(dir, file)], { encoding: 'utf8' });
    process.stdout.write(out);
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n✗ ${failed} 个测试文件失败`);
  process.exit(1);
}

console.log('\n✓ 全部测试文件通过');
