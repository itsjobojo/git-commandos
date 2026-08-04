const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Hero reticle — follows the pointer with a slight lag, hero section only.
const hero = document.querySelector('.hero');
const reticle = document.querySelector('.hero__reticle');
if (hero && reticle && !reduceMotion && matchMedia('(hover: hover) and (pointer: fine)').matches) {
  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let active = false;
  let raf = null;

  const tick = () => {
    x += (targetX - x) * 0.18;
    y += (targetY - y) * 0.18;
    reticle.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    if (active) raf = requestAnimationFrame(tick);
  };

  hero.addEventListener('pointerenter', () => {
    active = true;
    reticle.classList.add('is-visible');
    raf = requestAnimationFrame(tick);
  });
  hero.addEventListener('pointerleave', () => {
    active = false;
    reticle.classList.remove('is-visible');
    if (raf) cancelAnimationFrame(raf);
  });
  hero.addEventListener('pointermove', (e) => {
    const rect = hero.getBoundingClientRect();
    targetX = e.clientX - rect.left;
    targetY = e.clientY - rect.top;
  });
}

// Scroll reveals for section content.
const observeTargets = document.querySelectorAll(
  '.gallery-card, .manual__grid, .faq-list, .terminal--wide, .table-wrap'
);
if (!reduceMotion && 'IntersectionObserver' in window) {
  observeTargets.forEach((el) => el.classList.add('js-observe'));
  const reveal = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
  );
  observeTargets.forEach((el) => reveal.observe(el));
}

// Copy-to-clipboard on terminal blocks.
document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const text = btn.getAttribute('data-copy');
    const label = btn.querySelector('[data-copy-label]');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (label) {
      const original = label.textContent;
      label.textContent = 'COPIED ✓';
      btn.classList.add('is-copied');
      btn.setAttribute('aria-live', 'polite');
      setTimeout(() => {
        label.textContent = original;
        btn.classList.remove('is-copied');
      }, 1200);
    }
  });
});
