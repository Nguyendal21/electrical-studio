// Keep all network/update work in the main process. GitHub credentials are
// needed only by the release workflow; none are shipped to users.
function createUpdateController({ updater, dialog, getWindow, flushStorage }) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  let busy = false;
  let available;
  const declined = new Set();
  updater.on('update-available', info => { available = info; });
  // electron-updater also emits failures that reject the check/download promise.
  // Handle the event so a disconnected computer never crashes the application.
  updater.on('error', error => console.warn('Update:', error.message));
  updater.on('download-progress', progress => getWindow()?.setProgressBar(progress.percent / 100));
  const ask = options => {
    const window = getWindow();
    return window && !window.isDestroyed() ? dialog.showMessageBox(window, options) : Promise.resolve({ response: 1 });
  };
  return {
    async check() {
      if (busy) return;
      busy = true;
      available = undefined;
      let downloading = false;
      try {
        await updater.checkForUpdates();
        if (!available || declined.has(available.version)) return;
        const choice = await ask({
          type: 'info', title: 'Cập nhật Electrical Studio',
          message: `Có phiên bản mới ${available.version}`,
          detail: 'Bạn có muốn tải bản cập nhật không? Bạn vẫn có thể dùng ứng dụng trong khi tải.',
          buttons: ['Tải cập nhật', 'Để sau'], defaultId: 0, cancelId: 1, noLink: true,
        });
        if (choice.response !== 0) { declined.add(available.version); return; }
        downloading = true;
        await updater.downloadUpdate();
        downloading = false;
        getWindow()?.setProgressBar(-1);
        const install = await ask({
          type: 'info', title: 'Cập nhật đã sẵn sàng',
          message: `Cài phiên bản ${available.version} và mở lại ứng dụng?`,
          detail: 'Sơ đồ đang vẽ được giữ lại. Chọn “Để sau” để tiếp tục công việc; ứng dụng sẽ không tự cài khi bạn đóng cửa sổ.',
          buttons: ['Cài và mở lại', 'Để sau'], defaultId: 0, cancelId: 1, noLink: true,
        });
        if (install.response === 0) {
          await flushStorage();
          updater.quitAndInstall(false, true);
        } else declined.add(available.version);
      } catch (error) {
        // Checking is quiet when offline. A failed download requested by the
        // user is reported, and the old version continues to run unchanged.
        if (downloading) await ask({ type: 'warning', title: 'Chưa cập nhật được', message: 'Không tải được bản cập nhật.', detail: 'Ứng dụng vẫn dùng phiên bản hiện tại. Sẽ kiểm tra lại khi có kết nối mạng.', buttons: ['Đóng'], noLink: true });
        console.warn('Update check/download:', error.message);
      } finally {
        getWindow()?.setProgressBar(-1);
        busy = false;
      }
    },
  };
}
module.exports = { createUpdateController };
