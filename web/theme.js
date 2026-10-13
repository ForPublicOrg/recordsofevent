// Applies the saved theme before first paint. Dark is the default.
try { if (localStorage.getItem('roe.theme') === 'light') document.documentElement.dataset.theme = 'light'; } catch (e) { /* storage blocked */ }
