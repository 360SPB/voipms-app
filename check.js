const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const htmlPath = path.join(ROOT, 'public', 'index.html');
const serverPath = path.join(ROOT, 'server.js');
function readFile(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }
const html = readFile(htmlPath);
const server = readFile(serverPath);
const results = [];
function check(id, name, condition, fixHint) { results.push({ id, name, pass: !!condition, fixHint }); }
console.log('========================================');
console.log('  VC美国电话 - 功能完整度检测');
console.log('========================================\n');
if (!html) { console.log('找不到 public/index.html'); process.exit(1); }
if (!server) { console.log('找不到 server.js'); process.exit(1); }
check(1, '发送/接收短信(文字)', html.includes("API+'/api/sms/send'") && server.includes('sendSMS') && server.includes('getSMS'), '检查 server.js 是否有 /api/sms/send 和 /api/sms/list 路由');
check(2, '发送/接收图片(MMS)', (server.includes('sendMMS') || server.includes('media1')) && html.includes('handleFileSelect') && !html.includes("暂不支持"), '需要添加MMS发送API和真实上传逻辑');
check(3, '历史记录永久保存', html.includes("API+'/api/sms/conversations'") && html.includes("API+'/api/sms/list'"), '检查loadThreads和openThread是否调用历史接口');
check(4, '保持登录状态', html.includes("localStorage.getItem('vc_auth')") && html.includes("localStorage.setItem('vc_auth'") && html.includes('autoLogin'), '检查自动登录逻辑');
check(5, '拨打电话(呼出)', (html.includes('SIP.js') || html.includes('JsSIP')) && html.includes('sip:'), '需要引入SIP.js库并配置SIP账号实现真实呼叫');
check(6, '接听电话(呼入)', html.includes('Registerer') || html.includes('"invite"') || html.includes("'invite'"), '需要SIP注册并监听来电事件');
check(7, '联系人存储(增删改)', html.includes('function saveContact') && html.includes('function deleteContact') && html.includes('function editContact') && html.includes("localStorage.setItem('vc_contacts'"), '检查联系人增删改函数');
check(8, '联系人备注', html.includes('contact-name-input') && html.includes('getContactName'), '检查联系人姓名字段使用情况');
check(9, '界面响应式', html.includes('@media(max-width:768px)') && html.includes('mobile-nav') && html.includes('isMobile'), '检查响应式CSS和isMobile函数');
let passCount = 0;
results.forEach(r => {
  const icon = r.pass ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${r.id}. ${r.name}`);
  if (!r.pass) console.log(`    -> ${r.fixHint}`);
  if (r.pass) passCount++;
});
console.log('\n========================================');
console.log(`完成度: ${passCount}/${results.length} (${Math.round(passCount/results.length*100)}%)`);
console.log('========================================\n');
console.log('--- 额外Bug检测 ---\n');
const bugs = [];
const authCount = (html.match(/let AUTH\s*=/g) || []).length;
if (authCount > 1) bugs.push(`发现 ${authCount} 处重复的 "let AUTH =" 声明`);
const apiCount = (html.match(/const API\s*=/g) || []).length;
if (apiCount > 1) bugs.push(`发现 ${apiCount} 处重复的 "const API =" 声明`);
const bodyCloseCount = (html.match(/<\/body>/g) || []).length;
if (bodyCloseCount > 1) bugs.push(`发现 ${bodyCloseCount} 个</body>标签，应该只有1个`);
const apiUrlMatch = html.match(/const API\s*=\s*'([^']*)'/);
if (apiUrlMatch) {
  const apiUrl = apiUrlMatch[1];
  if (!apiUrl) bugs.push('API地址为空字符串');
  else console.log(`当前API地址: ${apiUrl}`);
}
if (!server.includes('sendMMS') && !server.includes('media')) bugs.push('server.js中没有MMS相关路由');
if (bugs.length === 0) console.log('未发现明显代码错误\n');
else { bugs.forEach(b => console.log(`警告: ${b}`)); console.log(''); }
console.log('========================================');
console.log('检测完成');
console.log('========================================');
