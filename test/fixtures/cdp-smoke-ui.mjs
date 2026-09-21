import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const exePath = path.join(process.env.LOCALAPPDATA, 'Programs', 'nizyla', 'NiZyLa.exe');
const port = 9555;
const outDir = path.resolve('release/smoke-screenshots');
await fs.mkdir(outDir, { recursive: true });
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function waitPort(){ for(let i=0;i<40;i++){ try{ await fetch(`http://127.0.0.1:${port}/json`); return; }catch{} await sleep(250);} throw new Error('CDP port not ready'); }
try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}
const child = spawn(exePath, [`--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore' });
child.unref();
await waitPort();
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t=>t.type==='page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej)=>{ ws.onopen=res; ws.onerror=rej; });
let id=1; const pending = new Map();
ws.onmessage = (e)=>{ const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){ const {res,rej}=pending.get(m.id); pending.delete(m.id); m.error?rej(new Error(m.error.message)):res(m.result); } };
function send(method, params={}){ return new Promise((res,rej)=>{ const mid=id++; pending.set(mid,{res,rej}); ws.send(JSON.stringify({id:mid,method,params})); }); }
async function evalJs(expression){ const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true}); return r.result.value; }
async function shot(name){ const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); const p=path.join(outDir,name); await fs.writeFile(p, Buffer.from(r.data,'base64')); console.log(p); }
await send('Page.setViewport',{width:1200,height:760}).catch(()=>{});
await sleep(1000);
await evalJs(`document.querySelectorAll('.mode-switch button')[1].click()`);
await sleep(900);
await shot('geometry-layout.png');
await evalJs(`document.querySelector('button[title="Terminal"]')?.click() || Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Terminal')).click()`);
await sleep(1200);
await evalJs(`document.querySelector('.terminal-pane-wrapper.active .xterm')?.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))`);
await send('Input.insertText', { text: 'python -c "print(\'SMOKE_OUTPUT ภาษาไทย\')"' });
await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
await sleep(2500);
const termText = await evalJs(`document.querySelector('.terminal-pane-wrapper.active')?.innerText || ''`);
if(!/SMOKE_OUTPUT ภาษาไทย[\s\S]*C:\\/.test(termText)) throw new Error('terminal output missing: '+termText);
await shot('terminal-run-output.png');
try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}
