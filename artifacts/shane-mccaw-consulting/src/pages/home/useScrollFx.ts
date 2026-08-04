import { useEffect, useRef } from "react";

/** Fades/slides an element in in when it scrolls into view, and count-ups any
 * `[data-countup]` descendants once revealed. Mirrors the design mockup's
 * `initReveal`/`countUp` behavior (IntersectionObserver + a sweep fallback for
 * elements already in view on first paint), reimplemented as a React hook
 * instead of raw `querySelectorAll` DOM manipulation. */
export function useReveal<T extends HTMLElement>(offsetX?: number) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.opacity = "1";
      el.style.transform = "none";
      return;
    }

    el.style.opacity = "0";
    el.style.transform = offsetX ? `translate3d(${offsetX}px,18px,0)` : "translateY(22px)";
    el.style.transition = "opacity .6s ease, transform .75s cubic-bezier(.2,.8,.2,1)";

    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      el.style.opacity = "1";
      el.style.transform = "none";
      countUp(el);
    };

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting || entry.boundingClientRect.top < 0) {
            reveal();
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    io.observe(el);

    const sweep = () => {
      if (done) return;
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) reveal();
    };
    sweep();
    const timers = [80, 300, 800, 1600].map((t) => window.setTimeout(sweep, t));
    window.addEventListener("scroll", sweep, { passive: true });
    window.addEventListener("resize", sweep);

    return () => {
      io.disconnect();
      timers.forEach(window.clearTimeout);
      window.removeEventListener("scroll", sweep);
      window.removeEventListener("resize", sweep);
    };
  }, [offsetX]);

  return ref;
}

function countUp(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-countup]").forEach((el) => {
    if (el.dataset.counted) return;
    el.dataset.counted = "1";
    const target = parseFloat(el.dataset.countup || "0");
    const dur = 1100;
    const t0 = Date.now();
    el.textContent = "0";
    const id = window.setInterval(() => {
      const t = Math.min(1, (Date.now() - t0) / dur);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t >= 1) window.clearInterval(id);
    }, 40);
    window.setTimeout(() => {
      window.clearInterval(id);
      el.textContent = String(target);
    }, dur + 400);
  });
}

/** Parallax offset for a decorative layer, driven by its parent's position
 * relative to viewport center. Mirrors the mockup's `initParallax`. */
export function useParallax<T extends HTMLElement>(factor: number) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let queued = false;
    const run = () => {
      queued = false;
      const r = parent.getBoundingClientRect();
      if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
      const mid = window.innerHeight / 2;
      const offset = (r.top + r.height / 2 - mid) * factor;
      el.style.transform = `translate3d(0,${offset.toFixed(1)}px,0)`;
    };
    const request = () => {
      if (!queued) {
        queued = true;
        window.setTimeout(run, 16);
      }
    };
    request();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    return () => {
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
    };
  }, [factor]);

  return ref;
}
