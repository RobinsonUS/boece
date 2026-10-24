// Small page behaviours that must not wait for the 3D code.
(function () {
  // the four lines about Boece come in once, one after the other
  var verses = document.querySelector('.verses[data-reveal]');
  if (verses) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { verses.classList.add('is-in'); io.disconnect(); }
        });
      }, { threshold: 0.35 });
      io.observe(verses);
    } else {
      verses.classList.add('is-in');
    }
  }

  // copy the contract address
  var btn = document.getElementById('ca-copy');
  var ca = document.getElementById('ca');
  if (btn && ca) {
    btn.addEventListener('click', function () {
      var text = ca.textContent.trim();
      var done = function (label) {
        btn.textContent = label;
        setTimeout(function () { btn.textContent = 'Copy'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done('Copied'); }, select);
      } else select();
      function select() {
        var r = document.createRange();
        r.selectNodeContents(ca);
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        done('Selected');
      }
    });
  }
})();
