// Vercel Web Analytics on the homepage only: the script loads only when the page opens on "/",
// and pageviews for any other path (after in-app navigation) are dropped before they're sent.
(function () {
  if (location.pathname !== '/') return;
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  window.va('beforeSend', function (e) { return new URL(e.url).pathname === '/' ? e : null; });
  var s = document.createElement('script');
  s.src = '/_vercel/insights/script.js';
  s.defer = true;
  document.head.appendChild(s);
})();
