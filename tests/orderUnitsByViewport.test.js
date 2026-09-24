// orderUnitsByViewport 单元测试
// 加载 src/content/dom-text.js 中的真实实现，注入 window/document 模拟视口后执行。
// 运行: node tests/orderUnitsByViewport.test.js

const { loadScripts } = require('./helpers/load-scripts');

const ctx = loadScripts(['src/shared/constants.js', 'src/content/dom-text.js'], {
  window: { innerWidth: 1200, innerHeight: 800 },
  document: { documentElement: { clientWidth: 1200, clientHeight: 800 } }
});
const order = ctx.orderUnitsByViewport;

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) passed++;
  else { failed++; console.error(`✗ ${name}`); }
}

// 构造在给定位置的一个“单元”：anchor 是 parentElement 的模拟
function makeUnit(id, rect) {
  const anchor = {
    id: 'el-' + id,
    getBoundingClientRect: () => rect
  };
  return { id, nodes: [{ parentElement: anchor }], original: id };
}
const inView = makeUnit('inView', { width: 200, height: 40, top: 100, bottom: 140, left: 50, right: 250 });
const belowFold = makeUnit('belowFold', { width: 200, height: 40, top: 9000, bottom: 9040, left: 50, right: 250 });
const deepBelow = makeUnit('deepBelow', { width: 200, height: 40, top: 15000, bottom: 15040, left: 50, right: 250 });
const farRight = makeUnit('farRight', { width: 200, height: 40, top: 200, bottom: 240, left: 5000, right: 5200 });

// 基本排序：可视单元排前，其余保持原顺序
{
  const out = order([belowFold, inView, deepBelow]);
  check('视口内单元被排到队首', out[0].id === 'inView');
  check('视口外单元保持原有相对顺序', out[1].id === 'belowFold' && out[2].id === 'deepBelow');
}

// 纯视口外：顺序保持不变
{
  const out = order([belowFold, farRight]);
  check('全部不可见时保持原顺序', out[0].id === 'belowFold' && out[1].id === 'farRight');
}

// 视口边缘预加载余量（默认 600px）：略高于/低于视口边缘的算“可见”
{
  const nearTop = makeUnit('nearTop', { width: 200, height: 40, top: -500, bottom: -460, left: 50, right: 250 });
  const nearBottom = makeUnit('nearBottom', { width: 200, height: 40, top: 1100, bottom: 1140, left: 50, right: 250 });
  const out = order([belowFold, nearTop, nearBottom]);
  check('视口上方 500px(在 600px 余量内)视为可见并优先', out[0].id === 'nearTop');
  check('视口下方 300px(在 600px 余量内)同样视为可见', out[1].id === 'nearBottom');
  check('超远内容仍排最后', out[2].id === 'belowFold');
}

// 超过预加载余量仍算不可见（排后且顺序保持）
{
  const farTop = makeUnit('farTop', { width: 200, height: 40, top: -900, bottom: -860, left: 50, right: 250 });
  const out = order([farTop, inView]);
  check('超出余量(-900px)不可见，排后', out[0].id === 'inView' && out[1].id === 'farTop');
}

// 无法测量（anchor 缺失）的单元排到末尾
{
  const weird = { id: 'weird', nodes: [{ parentElement: null }], original: 'weird' };
  const out = order([weird, inView]);
  check('无法测量的单元排到末尾', out[0].id === 'inView' && out[1].id === 'weird');
}

// 返回新数组，不修改原数组
{
  const arr = [belowFold, inView];
  const out = order(arr);
  check('不原地修改入参数组', arr[0] === belowFold && out !== arr);
}

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) process.exit(1);
