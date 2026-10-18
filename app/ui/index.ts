interface Window {
  healer: {
    getStatus(): Promise<{
      shell: string;
      automaticRepairAvailable: boolean;
      aiEnabled: boolean;
      automaticApplyEnabled: boolean;
    }>;
  };
}

const status = document.getElementById('status');
void window.healer.getStatus()
  .then((state) => {
    if (!status) return;
    status.textContent = state.shell === 'development-skeleton' &&
      state.automaticRepairAvailable === false &&
      state.aiEnabled === false &&
      state.automaticApplyEnabled === false
      ? '安全入口已响应；核心功能尚未开发。'
      : '应用状态不符合预期，操作已停用。';
  })
  .catch(() => {
    if (status) status.textContent = '无法验证应用入口，操作已停用。';
  });
