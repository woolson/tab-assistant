type ExtensionSurface = 'popup' | 'sidepanel';

const surface: ExtensionSurface = document.documentElement.dataset.surface === 'sidepanel'
  ? 'sidepanel'
  : 'popup';

const loadApplication = () => {
  const mount = () => {
    import('./index')
      .then(module => module.mountExtensionApp(surface))
      .catch(error => {
        console.error('Failed to load TabAssistant application', error);

        const status = document.querySelector<HTMLElement>('[data-popup-boot-status]');
        if (status) status.textContent = 'Failed to load';
      });
  };

  if (surface === 'sidepanel') {
    mount();
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      mount();
    });
  });
};

loadApplication();
