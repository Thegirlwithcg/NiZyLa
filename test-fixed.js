const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600 });
  const html = `
    <!DOCTYPE html>
    <html>
    <head><style>
      #container { margin-left: 200px; margin-top: 100px; width: 400px; height: 400px; container-type: inline-size; }
      #fixed { position: fixed; left: 50px; top: 50px; width: 50px; height: 50px; background: red; }
    </style></head>
    <body>
      <div id="container">
        <div id="fixed"></div>
      </div>
    </body>
    </html>
  `;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const rect = await win.webContents.executeJavaScript("document.getElementById('fixed').getBoundingClientRect().toJSON()");
  console.log('Fixed rect:', JSON.stringify(rect));
  app.quit();
});
