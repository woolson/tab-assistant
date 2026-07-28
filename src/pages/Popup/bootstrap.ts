const loadPopup = () => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      import('./index').catch(error => {
        console.error('Failed to load popup application', error);

        const status = document.querySelector<HTMLElement>('[data-popup-boot-status]');
        if (status) status.textContent = 'Failed to load';
      });
    });
  });
};

loadPopup();
