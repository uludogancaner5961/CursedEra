const { app, BrowserWindow } = require('electron');
const path = require('path');

// Sunucuyu başlat
require('./server.js');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true,
    title: "Cursed Era: Shinjuku Showdown"
  });

  // Süreyi 3 saniyeye çıkarıyoruz ki sunucu kesinlikle ayağa kalkmış olsun
  setTimeout(() => {
    win.loadURL('http://localhost:3000');
  }, 3000);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});