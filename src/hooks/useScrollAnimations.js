import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const useScrollAnimations = (dependencies = []) => {
    const hasAnimated = useRef(false);

    useEffect(() => {
          if (hasAnimated.current) return;
          hasAnimated.current = true;

                  const defaultDuration = 1.2;
          const defaultEase = 'power3.out';
          const animations = [];
          const triggers = [];

                  const createScrollTrigger = (element, animation, options = {}) => {
                          const trigger = ScrollTrigger.create({
                                    trigger: element,
                                    start: options.start || 'top 85%',
                                    once: true,
                                    onEnter: () => animation.play(),
                          });
                          triggers.push(trigger);
                          return trigger;
                  };

                  // Fade up animations
                  document.querySelectorAll('[data-animate="fade-up"]').forEach((el) => {
                          const delay = parseFloat(el.dataset.delay) || 0;
                          const duration = parseFloat(el.dataset.duration) || defaultDuration;
                          gsap.set(el, { opacity: 0, y: 60 });
                          const anim = gsap.to(el, { opacity: 1, y: 0, duration, delay, ease: defaultEase, paused: true });
                          animations.push(anim);
                          createScrollTrigger(el, anim);
                  });

                  // Fade right animations
                  document.querySelectorAll('[data-animate="fade-right"]').forEach((el) => {
                          const delay = parseFloat(el.dataset.delay) || 0;
                          const duration = parseFloat(el.dataset.duration) || defaultDuration;
                          gsap.set(el, { opacity: 0, x: 60 });
                          const anim = gsap.to(el, { opacity: 1, x: 0, duration, delay, ease: defaultEase, paused: true });
                          animations.push(anim);
                          createScrollTrigger(el, anim);
                  });

                  // Simple fade animations
                  document.querySelectorAll('[data-animate="fade"]').forEach((el) => {
                          const delay = parseFloat(el.dataset.delay) || 0;
                          const duration = parseFloat(el.dataset.duration) || 0.8;
                          gsap.set(el, { opacity: 0 });
                          const anim = gsap.to(el, { opacity: 1, duration, delay, ease: defaultEase, paused: true });
                          animations.push(anim);
                          createScrollTrigger(el, anim);
                  });

                  // Scale animations
                  document.querySelectorAll('[data-animate="scale"]').forEach((el) => {
                          const delay = parseFloat(el.dataset.delay) || 0;
                          const duration = parseFloat(el.dataset.duration) || defaultDuration;
                          gsap.set(el, { opacity: 0, scale: 0.92 });
                          const anim = gsap.to(el, { opacity: 1, scale: 1, duration, delay, ease: defaultEase, paused: true });
                          animations.push(anim);
                          createScrollTrigger(el, anim);
                  });

                  // Highlight clip-path animations
                  document.querySelectorAll('[data-animate="highlight"]').forEach((el) => {
                          const delay = parseFloat(el.dataset.delay) || 0;
                          const duration = parseFloat(el.dataset.duration) || 0.8;
                          gsap.set(el, { clipPath: 'inset(0 100% 0 0)' });
                          const anim = gsap.to(el, { clipPath: 'inset(0 0% 0 0)', duration, delay, ease: 'power2.inOut', paused: true });
                          animations.push(anim);
                          createScrollTrigger(el, anim);
                  });

                  // Stagger animations for lists
                  document.querySelectorAll('[data-animate="stagger"]').forEach((container) => {
                          const children = container.children;
                          const staggerDelay = parseFloat(container.dataset.stagger) || 0.1;
                          const delay = parseFloat(container.dataset.delay) || 0;
                          const duration = parseFloat(container.dataset.duration) || 0.8;
                          gsap.set(children, { opacity: 0, y: 40 });
                          const anim = gsap.to(children, { opacity: 1, y: 0, duration, delay, stagger: staggerDelay, ease: defaultEase, paused: true });
                          animations.push(anim);
                          createScrollTrigger(container, anim);
                  });

                  // Hero animations (immediate on load)
                  const heroElements = document.querySelectorAll('[data-animate-hero]');
          if (heroElements.length > 0) {
                  const heroTimeline = gsap.timeline({ defaults: { ease: defaultEase } });
                  heroElements.forEach((el) => {
                            const animType = el.dataset.animateHero;
                            const delay = parseFloat(el.dataset.delay) || 0;
                            const duration = parseFloat(el.dataset.duration) || defaultDuration;
                            switch (animType) {
                              case 'fade-up':
                                            gsap.set(el, { opacity: 0, y: 60 });
                                            heroTimeline.to(el, { opacity: 1, y: 0, duration }, delay);
                                            break;
                              case 'fade-right':
                                            gsap.set(el, { opacity: 0, x: 60 });
                                            heroTimeline.to(el, { opacity: 1, x: 0, duration }, delay);
                                            break;
                              case 'highlight':
                                            gsap.set(el, { clipPath: 'inset(0 100% 0 0)' });
                                            heroTimeline.to(el, { clipPath: 'inset(0 0% 0 0)', duration: 0.8, ease: 'power2.inOut' }, delay);
                                            break;
                              default:
                                            gsap.set(el, { opacity: 0 });
                                            heroTimeline.to(el, { opacity: 1, duration: 0.8 }, delay);
                            }
                  });
                  animations.push(heroTimeline);
          }

                  // Parallax effect
                  document.querySelectorAll('[data-parallax]').forEach((el) => {
                          const speed = parseFloat(el.dataset.parallax) || -30;
                          gsap.to(el, {
                                    y: speed,
                                    ease: 'none',
                                    scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 1 },
                          });
                  });

                  return () => {
                          animations.forEach((anim) => anim.kill?.());
                          triggers.forEach((trigger) => trigger.kill?.());
                          ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
                  };
    }, dependencies);
};

export default useScrollAnimations;
