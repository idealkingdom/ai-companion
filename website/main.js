// Complete GSAP Interaction logic for kdAina website

window.addEventListener('load', () => {
    // 1. Initialize Lenis for buttery momentum scrolling (like QuantumFusion)
    const lenis = new Lenis({
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // smooth ease out
        direction: 'vertical',
        gestureDirection: 'vertical',
        smooth: true,
        mouseMultiplier: 1,
        smoothTouch: false,
        touchMultiplier: 2,
        infinite: false,
    });

    lenis.on('scroll', ScrollTrigger.update);

    gsap.ticker.add((time)=>{
        lenis.raf(time * 1000);
    });

    gsap.ticker.lagSmoothing(0);

    // 2. Register ScrollTrigger
    gsap.registerPlugin(ScrollTrigger);

    const tl = gsap.timeline();

    // Slide the loader up and out
    tl.to(".loading-state", {
        yPercent: -100,
        duration: 0.8,
        ease: "power4.inOut",
        delay: 0.5 
    });

    // Animate the hero text in with a clean clip-path reveal
    tl.to(".hero-text .reveal-text", {
        clipPath: "inset(0% 0% 0% 0%)",
        y: 0,
        duration: 0.8,
        stagger: 0.15,
        ease: "power3.out"
    }, "-=0.3");

    // Animate hero buttons and visual
    tl.to(".hero-actions.reveal-block, .hero-visual.reveal-block", {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.6,
        stagger: 0.1,
        ease: "power2.out"
    }, "-=0.4");

    // 3. QF-Style Parallax & Scroll Animations
    
    // Smooth Parallax for Images
    gsap.utils.toArray(".mockup-img").forEach(img => {
        gsap.to(img, {
            yPercent: 15,
            ease: "none",
            scrollTrigger: {
                trigger: img.parentElement,
                start: "top bottom",
                end: "bottom top",
                scrub: true
            }
        });
    });

    // Section Headers Slide Reveal
    gsap.utils.toArray(".section-header.reveal-block").forEach(header => {
        gsap.fromTo(header, {
            opacity: 0,
            y: 60
        }, {
            scrollTrigger: {
                trigger: header,
                start: "top 85%",
            },
            opacity: 1,
            y: 0,
            duration: 1,
            ease: "power3.out"
        });
    });

    // Feature Cards (Staggered Grid)
    gsap.fromTo(".feature-card.reveal-block", {
        opacity: 0,
        y: 40
    }, {
        scrollTrigger: {
            trigger: ".feature-grid",
            start: "top 75%",
        },
        opacity: 1,
        y: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: "power2.out"
    });

    // How It Works Steps
    gsap.utils.toArray(".step-row.reveal-block").forEach((step, i) => {
        gsap.fromTo(step, {
            opacity: 0,
            x: -20
        }, {
            scrollTrigger: {
                trigger: step,
                start: "top 85%",
            },
            opacity: 1,
            x: 0,
            duration: 0.8,
            ease: "power2.out"
        });
    });

    // Agent Hub Content
    gsap.fromTo([".hub-visual.reveal-block", ".hub-text.reveal-block"], {
        opacity: 0,
        y: 40
    }, {
        scrollTrigger: {
            trigger: ".hub-content",
            start: "top 80%",
        },
        opacity: 1,
        y: 0,
        duration: 1,
        stagger: 0.2,
        ease: "power3.out"
    });

    // 4. Interaction Logic
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            
            if (targetElement) {
                lenis.scrollTo(targetElement, {
                    offset: -100, // Account for navbar
                    duration: 1.5,
                    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t))
                });
            }
        });
    });
});

// Clipboard Logic
window.copyInstallCmd = function() {
    const cmd = "ext install kdAina";
    navigator.clipboard.writeText(cmd).then(() => {
        const buttons = document.querySelectorAll('.btn-primary span');
        buttons.forEach(span => {
            const originalText = span.innerText;
            span.innerText = "Copied!";
            setTimeout(() => {
                span.innerText = originalText;
            }, 2000);
        });
    }).catch(err => {
        console.error('Failed to copy command: ', err);
    });
};
